// app/api/workFlow/saveExportConfiguration/route.js
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
  validateDestFields,
} from "@/lib/route-helpers";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 65_536; // 64 KB

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

// scheduleType → minutes convert
function normalizeScheduleType(raw) {
  const st = toStr(raw);
  const up = (st || "DAILY").toUpperCase();
  return up === "HOURLY" ? "HOURLY" : "DAILY";
}

function toScheduleMinutes(scheduleType, hourlyInterval) {
  if (String(scheduleType ?? "").toUpperCase() === "HOURLY") {
    const h = Number(hourlyInterval);
    return !isNaN(h) && h > 0 ? h * 60 : 60;
  }
  return 1440;
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

function normalizeOrgAgentMappings(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s.length ? s : null;
  }
  return JSON.stringify(raw);
}

export async function POST(request) {
  const requestId = crypto.randomUUID();

  try {
    const authErr = checkAuth(request);
    if (authErr) return authErr;

    const userId = request.headers.get("loggedinuserid");

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES)
      return badReq(`Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`);

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return badReq("Invalid JSON body.");
    }

    // ── Required field checks ─────────────────────────────────────────────────
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

    const destErr = validateDestFields(dest, body);
    if (destErr) return badReq(destErr);

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

    const dur = normalizeDuration(body);
    if (dur?.error) return badReq(dur.error);

    const scheduleType = normalizeScheduleType(body.scheduleType);
    const scheduleMinutes = toScheduleMinutes(scheduleType, body.hourlyInterval);

    const params = {
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
      S3SecretKey: encryptText(toStr(body.s3SecretKey)),
      S3StorageClass: toStr(body.s3StorageClass),
      // SFTP
      SftpServerName: toStr(body.sftpServerName),
      SftpBaseFolder: toStr(body.sftpBaseFolder),
      SftpUserId: toStr(body.sftpUserId),
      SftpPassword: encryptText(toStr(body.sftpPassword)),
      SftpSshKey: encryptText(toStr(body.sftpSshKey)),
      // GCP
      GcpBucket: toStr(body.gcpBucket),
      GcpProjectId: toStr(body.gcpProjectId),
      GcpServiceKey: encryptText(toStr(body.gcpServiceKey)),
      // Azure
      AzureAccount: toStr(body.azureAccount),
      AzureContainer: toStr(body.azureContainer),
      AzureConnection: encryptText(toStr(body.azureConnection)),
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
      CreatedBy: Number(userId),
    };

    const result = await executeStoredProcedure("usp_SaveExportConfiguration", params, OUTPUT_PARAMS);
    const { statusCode, message, recordset } = readSpResult(result);

    if (statusCode === 201) {
      const newId = recordset[0]?.NewId ?? null;
      return ok({ message, data: { id: newId } }, 201);
    }

    // 409 = duplicate rule name, 400 = bad request, 500 = server error — all handled here
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
    await logError("POST /api/workFlow/saveExportConfiguration", error, { requestId });
    console.error(`[saveExportConfiguration] requestId=${requestId}`, error);
    return internal();
  }
}
