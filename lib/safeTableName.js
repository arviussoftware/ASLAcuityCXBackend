/**
 * safeTableName.js
 *
 * Validates that a dynamically constructed table name matches a known-safe
 * pattern before it is interpolated into a SQL query string.
 *
 * Allowed patterns:
 *   - TblMst_Metadata_<4-digit year>  e.g. TblMst_Metadata_2024
 *   - TblLog_GlacierRestoration
 *
 * Usage:
 *   import { assertSafeTableName } from "@/lib/safeTableName";
 *   assertSafeTableName(tableName); // throws if invalid
 *   await pool.query(`SELECT * FROM public."${tableName}" WHERE ...`, [id]);
 */

/** Allowed static table names (exact match) */
const STATIC_WHITELIST = new Set(["TblLog_GlacierRestoration", "TblMst_Metadata"]);

/** Pattern for year-partitioned metadata tables: TblMst_Metadata_<YYYY> */
const PARTITIONED_METADATA_PATTERN = /^TblMst_Metadata_\d{4}$/;

/**
 * Returns true if the given table name is safe to interpolate into a SQL query.
 * @param {string} name
 * @returns {boolean}
 */
export function isSafeTableName(name) {
  if (typeof name !== "string" || !name) return false;
  if (STATIC_WHITELIST.has(name)) return true;
  if (PARTITIONED_METADATA_PATTERN.test(name)) return true;
  return false;
}

/**
 * Asserts that the given table name is safe. Throws a TypeError if not.
 * @param {string} name
 * @throws {TypeError}
 */
export function assertSafeTableName(name) {
  if (!isSafeTableName(name)) {
    throw new TypeError(
      `Unsafe or unknown table name rejected: "${name}". ` +
        `Only whitelisted table names may be interpolated into SQL queries.`
    );
  }
}
