import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import {
  OUTPUT_PARAMS,
  checkAuth,
  badReq,
  ok,
  internal,
  toStr,
  toIntParam,
  toSqlDateTime,
  readSpResult,
} from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

function normalizeOrgAgentMappings(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const s = raw.trim();
    return s.length ? s : null;
  }
  return JSON.stringify(raw);
}

export async function PUT(request) {
  const requestId = crypto.randomUUID();

  try {
    // 🔐 Authorization — shared helper (same as export route)
    const authErr = checkAuth(request);
    if (authErr) return authErr;

    let body;
    try {
      body = await request.json();
    } catch {
      return badReq("Invalid JSON body.");
    }

    // ── Required field validation ────────────────────────────────────────────
    if (!body.id) return badReq("id is required.");
    if (!toStr(body.ruleName)) return badReq("ruleName is required.");
    if (!body.instanceId) return badReq("instanceId is required.");
    if (!body.transcriptionEngine)
      return badReq("transcriptionEngine is required.");
    if (!body.startDateTime) return badReq("startDateTime is required.");

    const startDT = toSqlDateTime(body.startDateTime);
    if (!startDT) return badReq("startDateTime is invalid.");

    // ── orgAgentMappings validation (same as export route) ───────────────────
    const orgAgentMappings = normalizeOrgAgentMappings(body.orgAgentMappings);
    if (orgAgentMappings) {
      try {
        const parsed = JSON.parse(orgAgentMappings);
        if (!Array.isArray(parsed))
          return badReq("orgAgentMappings must be a JSON array.");
      } catch {
        return badReq("orgAgentMappings must be valid JSON.");
      }
    }

    const params = {
      // Identity
      RuleId: Number(body.id),
      // General
      RuleName: toStr(body.ruleName),
      Engine:
        body.transcriptionEngine != null
          ? Number(body.transcriptionEngine)
          : null,
      StartDateTime: startDT,
      Priority: String(body.processingPriority || "normal"),
      RuleIsEnabled: body.ruleEnabled !== false ? 1 : 0,
      // Instance
      Instance: body.instanceId != null ? Number(body.instanceId) : null,
      InstanceName: toStr(body.instanceName),

      OrgAgentMappings: orgAgentMappings,
      // Interaction Criteria
      ANI: toStr(body.ani),
      DNIS: toStr(body.dnis),
      ExtensionType: toStr(body.extType),
      ExtensionValue: toStr(body.extInput),
      ExtensionStart: body.extStart != null ? Number(body.extStart) : null,
      ExtensionEnd: body.extEnd != null ? Number(body.extEnd) : null,
      DurationOperator: toStr(body.durationOp),
      DurationValue:
        body.durationValue != null ? Number(body.durationValue) : null,
      DurationValueMax:
        body.durationValueMax != null ? Number(body.durationValueMax) : null,
      CustomField:
        toStr(body.customField) !== "none" ? toStr(body.customField) : null,
      CustomValue:
        toStr(body.customField) !== "none" ? toStr(body.customValue) : null,
      // Audit
      UpdatedBy: Number(body.createdBy),
    };
    const result = await executeStoredProcedure(
      "usp_UpdateTranscriptionRule",
      params,
      OUTPUT_PARAMS,
    );
    const { statusCode, message } = readSpResult(result);

    if (statusCode === 200) return ok({ message });

    return NextResponse.json(
      { success: false, message },
      { status: statusCode >= 400 ? statusCode : 500 },
    );
  } catch (error) {
    console.error(`[updateTranscriptionRule] requestId=${requestId}`, error);
    return internal();
  }
}
