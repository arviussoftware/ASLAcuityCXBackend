const postgresSchema = process.env.POSTGRES_SCHEMA || "public";

const postgresConfig = {
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 180000,
  ssl:
    String(process.env.POSTGRES_SSL || "false").toLowerCase() === "true"
      ? { rejectUnauthorized: false }
      : false,
};

// Module-level reference for dynamically loaded postgres driver to avoid
// importing it in environments (like AWS Lambda) where pg isn't needed.
let pg = null;

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function splitRoutineName(procedureName) {
  if (procedureName.includes(".")) {
    const [schemaName, routineName] = procedureName.split(".");
    return { schemaName, routineName };
  }

  return { schemaName: postgresSchema, routineName: procedureName };
}

function qualifiedRoutineName(schemaName, routineName) {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(routineName)}`;
}

function buildOutput(outputParameters = [], row = {}) {
  const params = Array.isArray(outputParameters) ? outputParameters : [];

  return params.reduce((acc, param) => {
    const key = param?.name;
    if (key) {
      acc[key] = row?.[key] ?? row?.[`p_${key}`] ?? null;
    }
    return acc;
  }, {});
}

function normalizePostgresResult(result, outputParameters = []) {
  const rows = result?.rows || [];
  const output = buildOutput(outputParameters, rows[0] || {});

  return {
    recordset: rows,
    recordsets: rows.length ? [rows] : [],
    rowsAffected: [result?.rowCount || 0],
    output,
  };
}

function normalizeParamName(name) {
  return String(name || "")
    .replace(/^p_/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function isTimestampType(argType) {
  return /\b(timestamp|date|time)\b/i.test(String(argType || ""));
}

function isUnsafeTimestampValue(value) {
  return (
    typeof value === "number" ||
    (typeof value === "string" && /^\d+$/.test(value.trim()))
  );
}

function sanitizeRoutineValue(name, value) {
  if (/password|secret|token/i.test(String(name || ""))) {
    return "[REDACTED]";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value.length > 80) {
    return value.substring(0, 80) + "... [TRUNCATED]";
  }

  return value;
}

function logPostgresInvocation(schemaName, routineName, invocation) {
  console.debug("[postgres routine]", {
    routine: `${schemaName}.${routineName}`,
    expectedParameterOrder: invocation.debugParameters.map((param) => ({
      name: param.name,
      type: param.type,
      mode: param.mode,
    })),
    mappedParameterValues: invocation.debugParameters.map((param) => ({
      name: param.name,
      value: sanitizeRoutineValue(param.name, param.value),
    })),
  });
}

function signatureInputParameters(signature) {
  const argTypes = signature?.input_arg_types || [];
  const argModes = signature?.arg_modes || [];
  const argNames = signature?.arg_names || [];

  return argTypes
    .map((argType, index) => ({
      name: argNames[index] || `arg${index + 1}`,
      normalizedName: normalizeParamName(argNames[index] || `arg${index + 1}`),
      type: String(argType || "").toLowerCase(),
      mode: argModes[index] || "i",
    }))
    .filter((arg) => ["i", "b", "v"].includes(arg.mode));
}

async function getPostgresRoutineSignatures(client, schemaName, routineName) {
  const result = await client.query(
    `
      SELECT
        p.proname,
        p.oid,
        p.prokind,
        p.pronargs,
        COALESCE(
          json_agg(
            format_type(
              routine_args.arg_type,
              NULL
            )
            ORDER BY routine_args.gs
          )
            FILTER (WHERE routine_args.gs IS NOT NULL),
          '[]'::json
        ) AS input_arg_types,
        COALESCE(
          json_agg(COALESCE((p.proargmodes::text[])[routine_args.gs], 'i') ORDER BY routine_args.gs)
            FILTER (WHERE routine_args.gs IS NOT NULL),
          '[]'::json
        ) AS arg_modes,
        COALESCE(
          json_agg(COALESCE((p.proargnames::text[])[routine_args.gs], '') ORDER BY routine_args.gs)
            FILTER (WHERE routine_args.gs IS NOT NULL),
          '[]'::json
        ) AS arg_names
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN LATERAL (
        SELECT
          args.ordinality AS gs,
          args.arg_type
        FROM unnest(COALESCE(p.proallargtypes::oid[], p.proargtypes::oid[]))
          WITH ORDINALITY AS args(arg_type, ordinality)
      ) AS routine_args ON true
      WHERE n.nspname = $1 AND LOWER(p.proname) = LOWER($2)
      GROUP BY p.proname, p.oid, p.prokind, p.pronargs
      ORDER BY p.oid
    `,
    [schemaName, routineName],
  );

  return result.rows;
}

function selectPostgresRoutineSignature(
  signatures,
  inputParameters,
  outputParameters,
  routineName,
) {
  const positionalInput = Array.isArray(inputParameters);
  const namedInput = isPlainObject(inputParameters);
  const inputCount = positionalInput
    ? inputParameters.length
    : Object.keys(inputParameters || {}).length;
  const outputCount = Array.isArray(outputParameters)
    ? outputParameters.length
    : 0;
  const outputNames = new Set(
    Array.isArray(outputParameters)
      ? outputParameters.map((param) => normalizeParamName(param?.name))
      : [],
  );

  let candidates = signatures;

  if (namedInput) {
    const normalizedInputNames = new Set(
      Object.keys(inputParameters || {}).map((key) => normalizeParamName(key)),
    );
    candidates = signatures.filter((signature) =>
      signatureInputParameters(signature).every((arg) => {
        if (arg.type === "refcursor") return true;
        if (arg.mode === "b" && outputNames.has(arg.normalizedName))
          return true;
        return normalizedInputNames.has(arg.normalizedName);
      }),
    );
  }

  const cursorCandidates = candidates.filter((signature) =>
    signatureInputParameters(signature).some(
      (arg) => String(arg.type || "").toLowerCase() === "refcursor",
    ),
  );

  if (cursorCandidates.length > 0) {
    candidates = cursorCandidates;
  }

  candidates.sort((left, right) => {
    const leftExact = left.proname === routineName ? 1 : 0;
    const rightExact = right.proname === routineName ? 1 : 0;
    if (leftExact !== rightExact) {
      return rightExact - leftExact;
    }
    const leftArgs = signatureInputParameters(left).length;
    const rightArgs = signatureInputParameters(right).length;
    return leftArgs - rightArgs;
  });

  return (
    candidates.find(
      (signature) => signature.pronargs === inputCount + outputCount,
    ) ||
    candidates.find((signature) => signature.pronargs === inputCount) ||
    candidates[0] ||
    null
  );
}

function buildPostgresRoutineInvocation(
  signature,
  inputParameters = {},
  outputParameters = [],
) {
  if (!signature) {
    throw new Error("PostgreSQL routine signature was not found");
  }

  const normalizedOutputParameters = Array.isArray(outputParameters)
    ? outputParameters
    : [];
  const positionalInput = Array.isArray(inputParameters);
  const namedInput = isPlainObject(inputParameters);
  const inputEntries = positionalInput
    ? inputParameters.map((value, index) => [String(index), value])
    : Object.entries(inputParameters || {});
  const remainingInputs = positionalInput ? [...inputEntries] : [];
  const normalizedInputMap = new Map(
    inputEntries.map(([key, value]) => [normalizeParamName(key), value]),
  );
  const usedInputKeys = new Set();
  const outputNames = new Set(
    normalizedOutputParameters.map((param) => normalizeParamName(param?.name)),
  );

  const argTypes = signature?.input_arg_types || [];
  const argModes = signature?.arg_modes || [];
  const argNames = signature?.arg_names || [];

  const values = [];
  const placeholders = [];
  const debugParameters = [];

  if (positionalInput) {
    console.warn(
      "PostgreSQL routine called with positional array parameters. Values must match the database parameter order exactly.",
    );
  }

  for (let index = 0; index < argTypes.length; index += 1) {
    const mode = argModes[index] || "i";
    const argType = String(argTypes[index] || "").toLowerCase();
    if (!["i", "b", "v"].includes(mode)) {
      continue;
    }

    const argName = argNames[index] || `arg${index + 1}`;
    const normalizedArgName = normalizeParamName(argName);

    let value;
    if (argType === "refcursor") {
      value = null;
    } else if (namedInput && normalizedInputMap.has(normalizedArgName)) {
      value = normalizedInputMap.get(normalizedArgName);
      usedInputKeys.add(normalizedArgName);
    } else if (mode === "b" && outputNames.has(normalizedArgName)) {
      value = null;
    } else if (positionalInput && remainingInputs.length > 0) {
      value = remainingInputs.shift()[1];
    } else {
      throw new Error(
        `Missing required PostgreSQL input parameter "${argName}" for routine signature`,
      );
    }

    if (isTimestampType(argType) && isUnsafeTimestampValue(value)) {
      throw new Error(
        `Invalid timestamp value for PostgreSQL parameter "${argName}". Expected Date or timestamp string, received ${JSON.stringify(value)}.`,
      );
    }

    values.push(value);
    placeholders.push(`$${values.length}::${argTypes[index]}`);
    debugParameters.push({
      name: argName,
      type: argTypes[index],
      mode,
      value,
    });
  }

  if (namedInput) {
    const extraInputs = inputEntries
      .map(([key]) => key)
      .filter((key) => !usedInputKeys.has(normalizeParamName(key)));

    if (extraInputs.length > 0) {
      console.warn(
        `Ignoring extra PostgreSQL input parameter(s): ${extraInputs.join(", ")}`,
      );
    }
  }

  return { values, placeholders, debugParameters };
}

async function executePostgresFunction(
  client,
  schemaName,
  routineName,
  invocation,
  signature,
  outputParameters,
) {
  const argTypes = signature?.input_arg_types || [];
  const hasRefcursors = argTypes.some(
    (t) => String(t || "").toLowerCase() === "refcursor",
  );

  if (hasRefcursors) {
    const query = `SELECT * FROM ${qualifiedRoutineName(schemaName, routineName)}(${invocation.placeholders.join(", ")})`;
    logPostgresInvocation(schemaName, routineName, invocation);
    await client.query("BEGIN");
    try {
      const result = await client.query(query, invocation.values);
      const rows = result?.rows || [];
      const firstRow = rows[0] || {};
      const output = buildOutput(outputParameters, firstRow);
      const recordsets = [];
      let recordset = [];

      const argNames = signature?.arg_names || [];
      const cursorNames = [];

      for (let i = 0; i < argTypes.length; i++) {
        if (String(argTypes[i] || "").toLowerCase() === "refcursor") {
          const colName = argNames[i] || `arg${i + 1}`;
          const val =
            firstRow[colName] ??
            firstRow[colName.toLowerCase()] ??
            firstRow[colName.toUpperCase()] ??
            null;
          if (val && typeof val === "string") {
            cursorNames.push(val);
          }
        }
      }

      // Fallback: match any column value matching regex
      if (cursorNames.length === 0) {
        const regexCursor = /^(ref_|.*_cursor$|^<unnamed portal \d+>$)/i;
        for (const val of Object.values(firstRow)) {
          if (typeof val === "string" && regexCursor.test(val)) {
            cursorNames.push(val);
          }
        }
      }

      for (const cursorName of cursorNames) {
        const cursorResult = await client.query(
          `FETCH ALL FROM ${quoteIdentifier(cursorName)}`,
        );
        const cursorRows = cursorResult?.rows || [];
        recordsets.push(cursorRows);
      }

      recordset = recordsets[0] || rows;
      await client.query("COMMIT");

      return {
        recordset,
        recordsets,
        rowsAffected: [result?.rowCount || 0],
        output,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } else {
    const query = `SELECT * FROM ${qualifiedRoutineName(schemaName, routineName)}(${invocation.placeholders.join(", ")})`;
    logPostgresInvocation(schemaName, routineName, invocation);
    const result = await client.query(query, invocation.values);
    return normalizePostgresResult(result, outputParameters);
  }
}

async function executePostgresProcedure(
  client,
  schemaName,
  routineName,
  invocation,
  signature,
  outputParameters,
) {
  const query = `CALL ${qualifiedRoutineName(schemaName, routineName)}(${invocation.placeholders.join(", ")})`;
  logPostgresInvocation(schemaName, routineName, invocation);

  await client.query("BEGIN");

  try {
    const result = await client.query(query, invocation.values);
    const rows = result?.rows || [];
    const firstRow = rows[0] || {};
    const output = buildOutput(outputParameters, firstRow);
    const recordsets = [];
    let recordset = [];

    const argTypes = signature?.input_arg_types || [];
    const argNames = signature?.arg_names || [];
    const cursorNames = [];

    for (let i = 0; i < argTypes.length; i++) {
      if (String(argTypes[i] || "").toLowerCase() === "refcursor") {
        const colName = argNames[i] || `arg${i + 1}`;
        const val =
          firstRow[colName] ??
          firstRow[colName.toLowerCase()] ??
          firstRow[colName.toUpperCase()] ??
          null;
        if (val && typeof val === "string") {
          cursorNames.push(val);
        }
      }
    }

    const regexCursor = /^(ref_|.*_cursor$|^<unnamed portal \d+>$)/i;
    if (cursorNames.length === 0) {
      for (const val of Object.values(firstRow)) {
        if (typeof val === "string" && regexCursor.test(val)) {
          cursorNames.push(val);
        }
      }
    }

    if (!cursorNames.length) {
      const inferredCursorNames = invocation.debugParameters
        .filter(
          (param) => String(param?.type || "").toLowerCase() === "refcursor",
        )
        .map((param) => param?.value)
        .filter(
          (value) => typeof value === "string" && regexCursor.test(value),
        );

      cursorNames.push(...inferredCursorNames);
    }

    for (const cursorName of cursorNames) {
      const cursorResult = await client.query(
        `FETCH ALL FROM ${quoteIdentifier(cursorName)}`,
      );
      const cursorRows = cursorResult?.rows || [];
      recordsets.push(cursorRows);
    }

    recordset = recordsets[0] || rows;

    await client.query("COMMIT");

    return {
      recordset,
      recordsets,
      rowsAffected: [result?.rowCount || 0],
      output,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function connectToPostgres() {
  if (!global.postgresConnectionPool) {
    if (!pg) {
      const pgImport = await import("pg");
      pg = pgImport.default || pgImport;
    }
    const Pool = pg.Pool;
    if (!Pool) {
      throw new Error("Could not load Pool from 'pg' module.");
    }
    global.postgresConnectionPool = new Pool(postgresConfig);
    global.postgresConnectionPool.on("error", (err) => {
      console.error("Unexpected PostgreSQL pool error:", err);
    });
  }

  return global.postgresConnectionPool;
}

async function executePostgresStoredProcedure(
  procedureName,
  inputParameters = {},
  outputParameters = [],
) {
  const pool = await connectToPostgres();
  const client = await pool.connect();
  const { schemaName, routineName } = splitRoutineName(procedureName);

  try {
    const signatures = await getPostgresRoutineSignatures(
      client,
      schemaName,
      routineName,
    );
    const signature = selectPostgresRoutineSignature(
      signatures,
      inputParameters,
      outputParameters,
      routineName,
    );
    const invocation = buildPostgresRoutineInvocation(
      signature,
      inputParameters,
      outputParameters,
    );

    const actualRoutineName = signature?.proname || routineName;

    return await executePostgresFunction(
      client,
      schemaName,
      actualRoutineName,
      invocation,
      signature,
      outputParameters,
    );
  } catch (functionError) {
    const canFallbackToCall =
      typeof functionError?.message === "string" &&
      (functionError.message.includes("is a procedure") ||
        functionError.message.includes("42809"));

    if (!canFallbackToCall) {
      console.error(
        `Failed to execute PostgreSQL routine via SELECT: ${procedureName}`,
        functionError,
      );
      throw functionError;
    }

    try {
      const signatures = await getPostgresRoutineSignatures(
        client,
        schemaName,
        routineName,
      );
      const signature = selectPostgresRoutineSignature(
        signatures,
        inputParameters,
        outputParameters,
        routineName,
      );
      const invocation = buildPostgresRoutineInvocation(
        signature,
        inputParameters,
        outputParameters,
      );

      const actualRoutineName = signature?.proname || routineName;

      return await executePostgresProcedure(
        client,
        schemaName,
        actualRoutineName,
        invocation,
        signature,
        outputParameters,
      );
    } catch (procedureError) {
      console.error(
        `Failed to execute PostgreSQL routine via CALL: ${procedureName}`,
        procedureError,
      );
      throw procedureError;
    }
  } finally {
    client.release();
  }
}

/**
 * Signs and sends a POST request to the API Gateway proxy using AWS SigV4.
 * On AWS Amplify the Compute Role credentials are picked up automatically.
 * Locally, set Amazon_ACCESS_KEY_ID + Amazon_SECRET_ACCESS_KEY in .env.
 */
async function signedProxyRequest(payload) {
  const apiUrl = process.env.LAMBDA_API_URL;
  if (!apiUrl) {
    throw new Error(
      "LAMBDA_API_URL is not configured while USE_LAMBDA_PROXY is true.",
    );
  }

  const url = new URL(apiUrl);
  const region = process.env.AWS_REGION || "us-east-1";
  const body = JSON.stringify(payload);

  // Dynamically import AWS SDK signing packages (not bundled on Lambda)
  const [{ SignatureV4 }, { Sha256 }, { defaultProvider }] = await Promise.all([
    import("@aws-sdk/signature-v4"),
    import("@aws-crypto/sha256-js"),
    import("@aws-sdk/credential-provider-node"),
  ]);

  const { decryptEnvKey } = await import("./lib/connectionCredentials.js");

  const rawAccessKeyId =
    process.env.AWS_ACCESS_KEY_ID || process.env.Amazon_ACCESS_KEY_ID;
  const rawSecretAccessKey =
    process.env.AWS_SECRET_ACCESS_KEY || process.env.Amazon_SECRET_ACCESS_KEY;

  const accessKeyId = decryptEnvKey(rawAccessKeyId);
  const secretAccessKey = decryptEnvKey(rawSecretAccessKey);
  const sessionToken =
    process.env.AWS_SESSION_TOKEN || process.env.Amazon_SESSION_TOKEN;

  let credentials;
  if (accessKeyId && secretAccessKey && !accessKeyId.includes("XXX")) {
    credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    };
  } else {
    credentials = defaultProvider();
  }

  const signer = new SignatureV4({
    credentials,
    region,
    service: "execute-api", // API Gateway service name for SigV4
    sha256: Sha256,
  });

  const requestToSign = {
    method: "POST",
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      host: url.hostname,
      "content-type": "application/json",
    },
    body,
  };

  const signed = await signer.sign(requestToSign);

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: signed.headers,
    body: signed.body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `API Gateway proxy call failed with status ${response.status}: ${errorText}`,
    );
  }

  return await response.json();
}

export async function executeStoredProcedure(
  procedureName,
  inputParameters = {},
  outputParameters = [],
) {
  if (process.env.USE_LAMBDA_PROXY === "true") {
    return await signedProxyRequest({
      procedureName,
      inputParameters,
      outputParameters,
    });
  }

  // Fallback to direct Postgres connection
  return await executePostgresStoredProcedure(
    procedureName,
    inputParameters,
    outputParameters,
  );
}

export async function TotalRecords(dataSet) {
  return dataSet?.[0]?.TotalCount ?? 0;
}

export const outputmsgParams = [
  {
    name: "outputmsg",
    dtype: "text",
    length: 100,
  },
];

export const outputmsgWithStatusCodeParams = [
  {
    name: "outputmsg",
    dtype: "text",
    length: 100,
  },
  {
    name: "statuscode",
    dtype: "integer",
  },
];

async function executeRawQuery(queryText, queryParams = []) {
  return await signedProxyRequest({ queryText, queryParams });
}

export async function connectToDatabase() {
  if (process.env.USE_LAMBDA_PROXY === "true") {
    return {
      query: async (text, params = []) => {
        return await executeRawQuery(text, params);
      },
      connect: async () => {
        return {
          query: async (text, params = []) => {
            return await executeRawQuery(text, params);
          },
          release: () => {},
        };
      },
    };
  }

  // Direct database connection fallback
  try {
    return await connectToPostgres();
  } catch (err) {
    console.error("Database connection failed:", err);
    throw err;
  }
}
