import { Pool } from "pg";

const postgresSchema = process.env.POSTGRES_SCHEMA || "public";

// postgresConfig will be initialized lazily inside connectToPostgres to avoid ESM import order timing issues.

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
  outputParameters,
) {
  const query = `SELECT * FROM ${qualifiedRoutineName(schemaName, routineName)}(${invocation.placeholders.join(", ")})`;
  logPostgresInvocation(schemaName, routineName, invocation);
  const result = await client.query(query, invocation.values);
  return normalizePostgresResult(result, outputParameters);
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

    const cursorNames = Object.values(firstRow).filter(
      (value) =>
        typeof value === "string" &&
        (/^[A-Za-z_][A-Za-z0-9_]*_cursor$/.test(value) ||
          /^<unnamed portal \d+>$/.test(value)),
    );

    if (!cursorNames.length) {
      const inferredCursorNames = invocation.debugParameters
        .filter(
          (param) => String(param?.type || "").toLowerCase() === "refcursor",
        )
        .map((param) => param?.value)
        .filter(
          (value) =>
            typeof value === "string" &&
            (/^[A-Za-z_][A-Za-z0-9_]*_cursor$/.test(value) ||
              /^<unnamed portal \d+>$/.test(value)),
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

let pgPool = null;

async function connectToPostgres() {
  if (!pgPool) {
    const host = process.env.POSTGRES_HOST || process.env.MSSQLDB_SERVER;
    const database = process.env.POSTGRES_DB || process.env.MSSQLDB_NAME;
    const user = process.env.POSTGRES_USER || process.env.MSSQLDB_USER;
    const password =
      process.env.POSTGRES_PASSWORD || process.env.MSSQLDB_PASSWORD;

    if (!host || !database || !user || !password) {
      const missing = [
        "POSTGRES_HOST",
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
      ]
        .filter((key) => !process.env[key])
        .join(", ");
      throw new Error(
        `Missing required PostgreSQL environment variable(s): ${missing}. ` +
          "Configure them in Lambda Environment Variables.",
      );
    }

    const postgresConfig = {
      user,
      password,
      host,
      database,
      port: parseInt(
        process.env.POSTGRES_PORT || process.env.MSSQLDB_PORT || "5432",
        10,
      ),
      // Pool sizing: Lambda keeps one container warm, so a small pool is fine.
      max: parseInt(process.env.POSTGRES_POOL_MAX || "5", 10),
      min: 0,
      idleTimeoutMillis: 1000,          // release idle connections quickly to prevent stale sockets
      connectionTimeoutMillis: 5000,    // fail fast if RDS is unreachable
      statement_timeout: 10000,         // abort queries that take longer than 10s (prevents container hangs)
      keepAlive: true,                  // prevent stale connection drops
      keepAliveInitialDelayMillis: 0,
      ssl:
        String(process.env.POSTGRES_SSL || "false").toLowerCase() === "true"
          ? { rejectUnauthorized: false }
          : false,
    };

    pgPool = new Pool(postgresConfig);
    pgPool.on("error", (err) => {
      console.error("Unexpected PostgreSQL pool error:", err);
      // Reset pool so next invocation reconnects cleanly
      pgPool = null;
    });
  }

  return pgPool;
}

export async function executePostgresStoredProcedure(
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

export async function executePostgresRawQuery(queryText, queryParams = []) {
  const pool = await connectToPostgres();
  const client = await pool.connect();
  try {
    const result = await client.query(queryText, queryParams);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
    };
  } catch (error) {
    // Classify common PostgreSQL error codes for better diagnostics
    const pg = error?.code;
    if (pg === "42601") throw new Error(`SQL syntax error: ${error.message}`);
    if (pg === "42703") throw new Error(`Column not found: ${error.message}`);
    if (pg === "42P01") throw new Error(`Table not found: ${error.message}`);
    if (pg === "23505")
      throw new Error(`Duplicate key violation: ${error.message}`);
    if (pg === "23503")
      throw new Error(`Foreign key violation: ${error.message}`);
    throw error;
  } finally {
    client.release();
  }
}
