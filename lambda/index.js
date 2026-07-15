import fs from "fs";
import path from "path";
import {
  executePostgresStoredProcedure,
  executePostgresRawQuery,
} from "./db-engine.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_QUERY_LENGTH = 8000;        // characters – prevents oversized payloads
const MAX_PARAMS_COUNT = 100;         // sanity limit on parameter arrays / objects

// ─── Helpers ──────────────────────────────────────────────────────────────────

function structuredLog(level, message, extra = {}) {
  console[level](
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      requestId: extra.requestId,
      ...extra,
    })
  );
}

/**
 * Basic input sanitation – rejects obviously dangerous patterns at the
 * Lambda layer before they ever reach the database engine.
 */
function validateQueryText(queryText) {
  if (typeof queryText !== "string") {
    throw new Error("queryText must be a string");
  }
  if (queryText.length === 0) {
    throw new Error("queryText must not be empty");
  }
  if (queryText.length > MAX_QUERY_LENGTH) {
    throw new Error(`queryText exceeds maximum allowed length of ${MAX_QUERY_LENGTH} characters`);
  }
}

function validateProcedureName(procedureName) {
  if (typeof procedureName !== "string" || procedureName.trim() === "") {
    throw new Error("procedureName must be a non-empty string");
  }
  // Allow: letters, digits, underscores, dots (schema.name)
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(procedureName.trim())) {
    throw new Error("procedureName contains invalid characters. Only letters, digits, underscores, and dots are allowed.");
  }
}

function validateQueryParams(queryParams) {
  if (!Array.isArray(queryParams)) {
    throw new Error("queryParams must be an array");
  }
  if (queryParams.length > MAX_PARAMS_COUNT) {
    throw new Error(`queryParams exceeds maximum allowed count of ${MAX_PARAMS_COUNT}`);
  }
}

function validateInputParameters(inputParameters) {
  if (
    inputParameters !== null &&
    !Array.isArray(inputParameters) &&
    typeof inputParameters !== "object"
  ) {
    throw new Error("inputParameters must be an object or array");
  }
  if (Array.isArray(inputParameters) && inputParameters.length > MAX_PARAMS_COUNT) {
    throw new Error(`inputParameters exceeds maximum allowed count of ${MAX_PARAMS_COUNT}`);
  }
}

function generateInsertStatement(table, cols, rows) {
  const colList = cols.split(',').map(c => c.trim()).join(', ');
  const valuesList = [];
  
  for (const row of rows) {
    if (row.trim() === "") continue;
    const vals = row.split('\t').map(val => {
      if (val === '\\N') {
        return 'NULL';
      }
      const escaped = val.replace(/'/g, "''");
      return `'${escaped}'`;
    });
    valuesList.push(`(${vals.join(', ')})`);
  }
  
  if (valuesList.length === 0) return "";
  return `INSERT INTO ${table} (${colList}) VALUES ${valuesList.join(', ')};`;
}

function convertCopyBlocks(sqlText) {
  const lines = sqlText.split(/\r?\n/);
  const outputLines = [];
  let inCopy = false;
  let copyTable = "";
  let copyCols = "";
  let copyRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inCopy) {
      if (line.trim() === "\\.") {
        const insertStmt = generateInsertStatement(copyTable, copyCols, copyRows);
        outputLines.push(insertStmt);
        inCopy = false;
        copyRows = [];
      } else {
        copyRows.push(line);
      }
      continue;
    }

    if (line.startsWith("\\restrict")) {
      continue;
    }
    
    if (line.startsWith("\\") && !line.startsWith("\\.")) {
      continue;
    }

    const copyMatch = line.match(/COPY\s+(["\w\.]+)\s*\((.*?)\)\s*FROM\s+stdin;/i);
    if (copyMatch) {
      inCopy = true;
      copyTable = copyMatch[1];
      copyCols = copyMatch[2];
      copyRows = [];
      continue;
    }

    outputLines.push(line);
  }

  return outputLines.join('\n');
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let dollarQuoteTag = null; // Stores the tag for dollar quoting, e.g. "$$"
  
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    
    // Handle escape characters inside single quotes
    if (inSingleQuote && char === "'" && sql[i + 1] === "'") {
      current += "''";
      i += 2;
      continue;
    }
    
    // Toggle single quotes
    if (!inDoubleQuote && !dollarQuoteTag && char === "'") {
      inSingleQuote = !inSingleQuote;
      current += char;
      i++;
      continue;
    }
    
    // Toggle double quotes
    if (!inSingleQuote && !dollarQuoteTag && char === '"') {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      i++;
      continue;
    }
    
    // Handle dollar quoting, e.g. $$ or $tag$
    if (!inSingleQuote && !inDoubleQuote && char === '$') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '$' && /[a-zA-Z0-9_]/.test(sql[j])) {
        j++;
      }
      if (j < sql.length && sql[j] === '$') {
        const tag = sql.substring(i, j + 1);
        if (dollarQuoteTag === tag) {
          dollarQuoteTag = null; // Closed dollar quote
        } else if (!dollarQuoteTag) {
          dollarQuoteTag = tag; // Opened dollar quote
        }
        current += tag;
        i = j + 1;
        continue;
      }
    }
    
    // Handle comments (ignore line comments starting with --)
    if (!inSingleQuote && !inDoubleQuote && !dollarQuoteTag && char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        i++;
      }
      continue;
    }
    
    // Handle multi-line comments /* ... */
    if (!inSingleQuote && !inDoubleQuote && !dollarQuoteTag && char === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    
    // Check for semicolon statement terminator
    if (char === ';' && !inSingleQuote && !inDoubleQuote && !dollarQuoteTag) {
      current += char;
      const stmt = current.trim();
      if (stmt) {
        statements.push(stmt);
      }
      current = "";
      i++;
      continue;
    }
    
    current += char;
    i++;
  }
  
  const finalStmt = current.trim();
  if (finalStmt) {
    statements.push(finalStmt);
  }
  
  return statements;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  const requestId = event?.requestId || "local";

  structuredLog("info", "Lambda invoked directly", { requestId });

  // ── Health check (action: "health") ──
  if (event?.action === "health") {
    return {
      status: "ok",
      service: "acuitycx-db-sql-executor",
      version: "2.0.0",
      timestamp: new Date().toISOString(),
    };
  }

  // ── Database Initialization (action: "initialize_db") ──
  if (event?.action === "initialize_db") {
    try {
      structuredLog("info", "Starting database schema initialization", { requestId });

      // 1. Check if the schema is already initialized
      const tableCheck = await executePostgresRawQuery(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'tblmst_userdetails'
        );`
      );

      const schemaExists = tableCheck.rows[0]?.exists;
      if (schemaExists) {
        structuredLog("info", "Database schema already initialized. Skipping.", { requestId });
        return { status: "skipped", message: "Schema already exists" };
      }

      // 2. Read acuitycx.sql from the Lambda package
      const sqlPath = path.join(process.cwd(), "acuitycx.sql");
      if (!fs.existsSync(sqlPath)) {
        throw new Error(`acuitycx.sql not found at path: ${sqlPath}`);
      }

      const sqlText = fs.readFileSync(sqlPath, "utf-8");

      // 3. Convert COPY blocks to INSERT statements and strip out psql meta-commands
      const convertedSql = convertCopyBlocks(sqlText);

      // 4. Split SQL into individual statements
      const statements = splitSqlStatements(convertedSql);

      structuredLog("info", `Executing database schema DDL & DML script (${statements.length} statements)...`, { requestId });

      // Execute each statement sequentially
      for (let idx = 0; idx < statements.length; idx++) {
        const stmt = statements[idx];
        try {
          await executePostgresRawQuery(stmt);
        } catch (stmtError) {
          structuredLog("error", `Statement ${idx + 1} failed: ${stmtError.message}`, {
            requestId,
            statementIndex: idx + 1,
            statementSnippet: stmt.substring(0, 500) + (stmt.length > 500 ? "..." : "")
          });
          throw new Error(`Statement ${idx + 1} failed: ${stmtError.message} | Snippet: ${stmt.substring(0, 300)}`);
        }
      }

      structuredLog("info", "Database schema initialized successfully!", { requestId });
      return { status: "success", message: "Schema initialized successfully" };
    } catch (error) {
      structuredLog("error", "Database initialization failed", {
        requestId,
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Database Initialization Failed: ${error.message}`);
    }
  }

  const {
    procedureName,
    inputParameters = {},
    outputParameters = [],
    queryText,
    queryParams = [],
  } = event || {};

  // ── Raw SQL query ──────────────────────────────────────────────────────────
  if (queryText !== undefined) {
    try {
      validateQueryText(queryText);
      validateQueryParams(queryParams);

      structuredLog("info", "Executing raw query", {
        requestId,
        queryLength: queryText.length,
        paramCount: queryParams.length,
      });

      const result = await executePostgresRawQuery(queryText, queryParams);

      structuredLog("info", "Raw query succeeded", {
        requestId,
        rowCount: result.rowCount,
      });

      return result;
    } catch (error) {
      structuredLog("error", "Raw query failed", {
        requestId,
        error: error.message,
        stack: error.stack,
      });
      throw new Error(`Raw Query Failed: ${error.message}`);
    }
  }

  // ── Stored Procedure / Function ────────────────────────────────────────────
  if (!procedureName) {
    throw new Error("Missing required field: either 'queryText' or 'procedureName' or 'action' must be provided");
  }

  try {
    validateProcedureName(procedureName);
    validateInputParameters(inputParameters);

    structuredLog("info", "Executing stored procedure", {
      requestId,
      procedureName,
    });

    const result = await executePostgresStoredProcedure(
      procedureName.trim(),
      inputParameters,
      outputParameters
    );

    structuredLog("info", "Stored procedure succeeded", {
      requestId,
      procedureName,
      rowsAffected: result?.rowsAffected,
    });

    return result;
  } catch (error) {
    structuredLog("error", `Stored procedure failed: ${procedureName}`, {
      requestId,
      error: error.message,
      stack: error.stack,
    });
    throw new Error(`Stored Procedure Failed: ${error.message}`);
  }
};