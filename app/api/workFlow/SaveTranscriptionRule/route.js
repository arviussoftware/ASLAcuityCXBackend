import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import {
  OUTPUT_PARAMS,
  checkAuth,
  badReq,
  ok,
  internal,
  toStr,
  toSqlDateTime,
  readSpResult,
} from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 65_536;

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

    const {
      ruleName,
      transcriptionEngine,
      startDateTime,
      processingPriority,
      ruleEnabled,
      ani,
      dnis,
      extType,
      extInput,
      extStart,
      extEnd,
      durationOp,
      durationValue,
      durationValueMax,
      instanceName,
      instanceId,
      customField,
      customValue,
      createdBy,
    } = body;

    if (!ruleName || !transcriptionEngine || !startDateTime || !createdBy) {
      return badReq("Missing required fields");
    }

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

    // ✅ Your original params — untouched
    const result = await executeStoredProcedure(
      "usp_SaveTranscriptionRule",
      {
        RuleName: String(ruleName),
        TranscriptionEngine: String(transcriptionEngine),
        StartDateTime: new Date(startDateTime),
        ProcessingPriority: String(processingPriority || "normal"),
        RuleEnabled: ruleEnabled ? 1 : 0,
        ANI: ani ? String(ani) : null,
        DNIS: dnis ? String(dnis) : null,
        ExtType: extType ? String(extType) : null,
        ExtInput: extInput ? String(extInput) : null,
        ExtStart: Number(extStart) || null,
        ExtEnd: Number(extEnd) || null,
        DurationOp: durationOp ? String(durationOp) : null,
        DurationValue: Number(durationValue) || null,
        DurationValueMax: Number(durationValueMax) || null,
        InstanceName: instanceName ? String(instanceName) : null,
        InstanceId: instanceId ? Number(instanceId) : null,
        CustomField:
          customField && customField !== "none" ? String(customField) : null,
        CustomValue:
          customField && customField !== "none" ? String(customValue) : null,
        CreatedBy: createdBy ? Number(createdBy) : null,
        OrgAgentMappings: orgAgentMappings,
      },
      OUTPUT_PARAMS,
    );

    const { statusCode, message, recordset } = readSpResult(result);

    if (statusCode === 201) {
      const newId =
        recordset?.[0]?.NewId ||
        recordset?.[0]?.RuleId ||
        recordset?.[0]?.NewRuleId ||
        null;
      return ok({ message, data: { id: newId } }, 201);
    }

    return NextResponse.json(
      { success: false, message },
      { status: statusCode >= 400 ? statusCode : 500 },
    );
  } catch (error) {
    console.error("[saveTranscriptionRule]", error.message);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
