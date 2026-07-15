// app/api/workFlow/updateExportConfiguration/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { encryptText } from "@/lib/exporter/token.js";
import {
  OUTPUT_PARAMS,
  VALID_EXPORT_PATHS,
  VALID_CDR_FORMATS,
  checkAuth,
  badReq,
  ok,
  internal,
  toStr,
  toSqlDateTime,
  readSpResult,
} from "@/lib/route-helpers";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

function normalizeDuration(body) {
  const opRaw = toStr(body?.durationOp);
  const op = opRaw ? opRaw.toLowerCase() : "";
  const hasValue = body?.durationValue != null && String(body.durationValue).trim() !== "";
  const hasMax = body?.durationValueMax != null && String(body.durationValueMax).trim() !== "";

  if (!op || !hasValue) {
    return { DurationOp: null, DurationValue: null, DurationValueMax: null };
  }
  if (op === "bw" && !hasMax) {
    return { error: "durationValueMax is required when durationOp is 'bw' (between)." };
  }
  return {
    DurationOp: op,
    DurationValue: Number(body.durationValue),
    DurationValueMax: hasMax ? Number(body.durationValueMax) : null,
  };
}

function normalizeOrgAgentMappings(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s.length ? s : null;
  }
  if (Array.isArray(raw) && raw.length === 0) return "[]";
  return JSON.stringify(raw);
}

function normalizeScheduleType(raw) {
  const st = toStr(raw);
  const up = (st || "DAILY").toUpperCase();
  return up === "HOURLY" ? "HOURLY" : "DAILY";
}

// ── scheduleType → minutes ────────────────────────────────────────────────────
// DAILY  → 1440 min
// HOURLY → hourlyInterval × 60 min  (fallback: 60)
function toScheduleMinutes(scheduleType, hourlyInterval) {
  if (String(scheduleType ?? "").toUpperCase() === "HOURLY") {
    const h = Number(hourlyInterval);
    return !isNaN(h) && h > 0 ? h * 60 : 60;
  }
  return 1440; // DAILY default
}

function normalizeMultiValue(raw) {
  const str = toStr(raw);
  if (!str) return null;
  const parts = str
    .split(/[\n\r,]+/g)
    .map((v) => v.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out.length ? out.join(",") : null;
}

export async function PUT(request) {
  const requestId = crypto.randomUUID();

  try {
    const authErr = checkAuth(request);
    if (authErr) return authErr;

    const userId = request.headers.get("loggedinuserid");

    let body;
    try {
      body = await request.json();
    } catch {
      return badReq("Invalid JSON body.");
    }

    // ── Required field checks ─────────────────────────────────────────────────
    if (!body.id) return badReq("id is required.");
    if (!body.platformId) return badReq("platformId is required.");
    if (!toStr(body.ruleName)) return badReq("ruleName is required.");
    if (!body.instanceId) return badReq("instanceId is required.");
    if (!body.startDateTime) return badReq("startDateTime is required.");

    const dest = toStr(body.exportPath)?.toUpperCase() ?? "";
    if (!VALID_EXPORT_PATHS.has(dest))
      return badReq(`exportPath must be one of: ${[...VALID_EXPORT_PATHS].join(", ")}.`);

    const startDT = toSqlDateTime(body.startDateTime);
    if (!startDT) return badReq("startDateTime is invalid.");

    const endDT = toSqlDateTime(body.toDateTime);
    if (endDT && endDT <= startDT)
      return badReq("toDateTime must be after startDateTime.");

    const cdrFmt = String(body.cdrFormat ?? "csv").toLowerCase();
    if (!VALID_CDR_FORMATS.has(cdrFmt))
      return badReq("cdrFormat must be 'csv' or 'xml'.");

    const orgAgentMappings = normalizeOrgAgentMappings(body.orgAgentMappings);
    if (orgAgentMappings) {
      try {
        const parsed = JSON.parse(orgAgentMappings);
        if (!Array.isArray(parsed)) return badReq("orgAgentMappings must be a JSON array.");
      } catch {
        return badReq("orgAgentMappings must be valid JSON.");
      }
    }

    // ── Schedule minutes ──────────────────────────────────────────────────────
    const scheduleType = normalizeScheduleType(body.scheduleType);
    const scheduleMinutes = toScheduleMinutes(scheduleType, body.hourlyInterval);

    const dur = normalizeDuration(body);
    if (dur?.error) return badReq(dur.error);

    const params = {
      Id: Number(body.id),
      PlatformId: Number(body.platformId),
      RuleName: toStr(body.ruleName).trim(),
      InstanceId: Number(body.instanceId),
      InstanceName: toStr(body.instanceName),
      StartDateTime: startDT,
      ToDateTime: endDT,
      ExportPath: dest,
      FileName: toStr(body.fileName),
      RuleEnabled: body.ruleEnabled !== false,
      OrgAgentMappings: orgAgentMappings,
      // Schedule
      ScheduleType: scheduleType,
      ScheduleMinutes: scheduleMinutes,
      // S3
      S3FileFormat: toStr(body.s3FileFormat),
      S3BucketRegion: toStr(body.s3BucketRegion),
      S3BucketName: toStr(body.s3BucketName),
      S3AccessKey: toStr(body.s3AccessKey),
      S3SecretKey: body.s3SecretKey === "********" ? null : encryptText(toStr(body.s3SecretKey)), // blank/null = SP keeps existing
      S3StorageClass: toStr(body.s3StorageClass),
      // SFTP
      SftpServerName: toStr(body.sftpServerName),
      SftpBaseFolder: toStr(body.sftpBaseFolder),
      SftpUserId: toStr(body.sftpUserId),
      SftpPassword: body.sftpPassword === "********" ? null : encryptText(toStr(body.sftpPassword)), // blank/null = SP keeps existing
      SftpSshKey: body.sftpSshKey === "********" ? null : encryptText(toStr(body.sftpSshKey)), // blank/null = SP keeps existing
      // GCP
      GcpBucket: toStr(body.gcpBucket),
      GcpProjectId: toStr(body.gcpProjectId),
      GcpServiceKey: body.gcpServiceKey === "********" ? null : encryptText(toStr(body.gcpServiceKey)), // blank/null = SP keeps existing
      // Azure
      AzureAccount: toStr(body.azureAccount),
      AzureContainer: toStr(body.azureContainer),
      AzureConnection: body.azureConnection === "********" ? null : encryptText(toStr(body.azureConnection)), // blank/null = SP keeps existing
      // Local
      DestDirectory: toStr(body.destDirectory),
      // CDR
      EnableCDR: !!body.enableCDR,
      CdrFormat: cdrFmt,
      CdrFileName: toStr(body.cdrFileName),
      ExportMetadataColumn: toStr(body.exportMetadataColumn),
      // Criteria
      Ani: normalizeMultiValue(body.ani),
      Dnis: normalizeMultiValue(body.dnis),
      ExtType: toStr(body.extType),
      ExtInput: normalizeMultiValue(body.extInput),
      ExtStart: toStr(body.extStart),
      ExtEnd: toStr(body.extEnd),
      DurationOp: dur.DurationOp,
      DurationValue: dur.DurationValue,
      DurationValueMax: dur.DurationValueMax,
      CustomField: toStr(body.customField) || null,
      CustomValue: normalizeMultiValue(body.customValue),
      // Audit
      ModifiedBy: Number(userId),
    };

    const result = await executeStoredProcedure("usp_UpdateExportConfiguration", params, OUTPUT_PARAMS);
    const { statusCode, message } = readSpResult(result);

    if (statusCode === 200) {
      return ok({ message });
    }

    return NextResponse.json(
      { success: false, message },
      { status: statusCode >= 400 ? statusCode : 500 },
    );
  } catch (error) {
    // Fallback: if DB enforces uniqueness via unique index (2601/2627), surface 409 instead of 500.
    const errNo = Number(error?.number ?? error?.code);
    if (errNo === 2601 || errNo === 2627) {
      const msg =
        error?.message
        || "This export configuration already exists. Please change at least one setting (or edit the existing rule).";
      return NextResponse.json({ success: false, message: msg }, { status: 409 });
    }
    await logError("PUT /api/workFlow/updateExportConfiguration", error, { requestId });
    console.error(`[updateExportConfiguration] requestId=${requestId}`, error);
    return internal();
  }
}
