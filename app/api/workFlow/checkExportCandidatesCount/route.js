// app/api/workFlow/checkExportCandidatesCount/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import {
  checkAuth,
  badReq,
  ok,
  internal,
  toStr,
  toSqlDateTime,
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
  try {
    const authErr = checkAuth(request);
    if (authErr) return authErr;

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES)
      return badReq(`Request body exceeds the ${MAX_BODY_BYTES}-byte limit.`);

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return badReq("Invalid JSON body.");
    }

    if (!body.platformId) return badReq("platformId is required.");
    if (!body.instanceId) return badReq("instanceId is required.");
    if (!body.startDateTime) return badReq("startDateTime is required.");

    const startDT = toSqlDateTime(body.startDateTime);
    if (!startDT) return badReq("startDateTime is invalid.");

    const endDT = toSqlDateTime(body.toDateTime);
    if (endDT && endDT <= startDT)
      return badReq("toDateTime must be after startDateTime.");

    const orgAgentMappings = normalizeOrgAgentMappings(body.orgAgentMappings);

    const dur = normalizeDuration(body);
    if (dur?.error) return badReq(dur.error);

    const params = {
      PlatformId: Number(body.platformId),
      InstanceId: Number(body.instanceId),
      StartDateTime: startDT,
      ToDateTime: endDT,
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
      OrgAgentMappings: orgAgentMappings,
      ExportConfigId: body.id ? Number(body.id) : null,
    };

    const result = await executeStoredProcedure("usp_GetExportCandidatesCountByParams", params);
    
    const count = Number(result?.recordset?.[0]?.totalcount ?? result?.recordset?.[0]?.TotalCount ?? 0);

    return ok({
      success: true,
      count,
    });
  } catch (error) {
    await logError("POST /api/workFlow/checkExportCandidatesCount", error);
    console.error("[checkExportCandidatesCount] Error:", error);
    return internal();
  }
}
