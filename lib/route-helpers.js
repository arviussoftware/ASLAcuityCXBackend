// lib/route-helpers.js
import { NextResponse } from "next/server";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export const OUTPUT_PARAMS = [
  { name: "outputmsg"  },
  { name: "statuscode" },
];

export const PAGINATION_OUTPUT_PARAMS = [
  { name: "outputmsg" },
  { name: "statuscode" },
  { name: "TotalCount" },
];

export const VALID_EXPORT_PATHS = new Set(["S3", "SFTP", "GCP", "AZURE", "LOCAL"]);
export const VALID_CDR_FORMATS  = new Set(["csv", "xml"]);

// ── Response helpers ──────────────────────────────────────────────────────────

export const ok       = (data, status = 200) => NextResponse.json({ success: true,  ...data }, { status });
export const fail     = (message, status)     => NextResponse.json({ success: false, message }, { status });
export const badReq   = (message)             => fail(message, 400);
export const unauth   = (reason)              => fail(`Unauthorized: ${reason}`, 401);
export const internal = ()                    => fail("Internal server error.", 500);

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Returns error response or null if valid. Next.js lowercases all header names. */
export function checkAuth(request) {
  const auth   = request.headers.get("authorization") ?? "";
  const userId = request.headers.get("loggedinuserid");           // lowercased by Next.js

  if (!auth.startsWith("Bearer "))          return unauth("Token missing");
  if (auth.slice(7) !== API_SECRET_TOKEN)   return unauth("Invalid token");
  if (!userId || !userId.trim())            return badReq("loggedInUserId header is required.");
  return null;
}

/** Same as checkAuth but skips userId check (GET endpoints). */
export function checkAuthOnly(request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer "))        return unauth("Token missing");
  if (auth.slice(7) !== API_SECRET_TOKEN) return unauth("Invalid token");
  return null;
}

// Type coercions 

export function toStr(raw) {
  const s = String(raw ?? "").trim();
  return s.length > 0 ? s : null;
}

export function toIntParam(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;          // accepts 0; rejects NaN/floats
}

export function toSqlDateTime(value) {
  if (!value) return null;
  try {
    const s = String(value).trim();
    const d = new Date(s.length === 16 ? `${s}:00` : s);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// SP result reader 

export function readSpResult(result) {
  const output = result?.output ?? {};
  return {
    statusCode: Number(output?.statuscode ?? 500),
    message: String(output?.outputmsg ?? "Unknown error"),
    recordset: result?.recordset ?? [],
    recordsets: result?.recordsets ?? [],
    outputParams: output,
  };
}

// Destination field validation (Save only — secrets required)

export function validateDestFields(dest, b) {
  const required = {
    S3:    [["s3BucketName","S3 Bucket Name"],
            ["s3AccessKey","S3 Access Key"],["s3SecretKey","S3 Secret Key"]],
    SFTP:  [["sftpServerName","SFTP Server Name"],["sftpBaseFolder","SFTP Base Folder"],
            ["sftpUserId","SFTP User ID"],["sftpPassword","SFTP Password"],["sftpSshKey","SFTP SSH Key"]],
    GCP:   [["gcpBucket","GCP Bucket"],["gcpProjectId","GCP Project ID"],["gcpServiceKey","GCP Service Key"]],
    AZURE: [["azureAccount","Azure Account"],["azureContainer","Azure Container"],["azureConnection","Azure Connection"]],
    LOCAL: [],
  };
  for (const [field, label] of (required[dest] ?? [])) {
    if (!toStr(b[field])) return `${label} is required for ${dest}.`;
  }
  return null;
}
