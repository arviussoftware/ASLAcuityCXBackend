// app/api/interactions/[id]/route.js

import { isInvalid, isValidPositiveInteger } from "@/lib/generic";
import { NextResponse } from "next/server";
import { setInteractions } from "@/lib/models/interaction";
import {
  executeStoredProcedure,
  connectToDatabase,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logAudit } from "@/lib/auditLogger";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { assertSafeTableName } from "@/lib/safeTableName";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request, { params }) {
  try {
    const authHeader = request.headers.get("authorization");
    const { id: interactionId } = await params;

    const loggedInUserId = request.headers.get("loggedInUserId");
    const userName = request.headers.get("userName");
    const timezone = request.headers.get("timezone");
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    if (!isValidPositiveInteger(interactionId)) {
      await logWarning(
        `GET /api/interactions/${interactionId}`,
        "Invalid interactionId path parameter.",
      );
      return NextResponse.json(
        { message: "Invalid interaction identifier." },
        { status: 400 },
      );
    }

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Headers or Parameter are missing or undefined or empty." },
        { status: 400 },
      );
    }

    let interactions = null;

    // Try SP first
    try {
      const result = await getInteractionById(
        interactionId,
        loggedInUserId,
        timezone,
      );
      if (result?.recordsets?.length > 0 && result?.recordset?.length > 0) {
        interactions = await setInteractions(result.recordsets[0]);
      } else if (result?.rows?.length > 0) {
        interactions = await setInteractions(result.rows);
      }
    } catch (spErr) {
      logWarning(
        `GET /api/interactions/${interactionId}`,
        "SP failed, using direct query fallback",
        { error: spErr.message },
      );
    }

    // SP returned empty or threw — fall back to direct parameterized query
    if (!interactions || interactions.length === 0) {
      interactions = await getInteractionDirect(interactionId);
    }

    if (interactions && interactions.length > 0) {
      const callId = interactions[0]?.callId || interactionId;
      await logAudit({
        userId: loggedInUserId,
        userName: userName,
        actionType: "VIEW_INTERACTION",
        interactionId,
        description: `User viewed interaction ${callId}`,
      });
      await logSuccess(
        `GET /api/interactions/${interactionId}`,
        "Interaction fetched successfully.",
        {
          loggedInUserId,
          interactionId,
          callId,
        },
      );
      return NextResponse.json(
        { message: "Success", interactions },
        { status: 200 },
      );
    }

    return NextResponse.json({ message: "Record Not Found." }, { status: 404 });
  } catch (error) {
    logError(`GET /api/interactions/${interactionId}`, error);
    // Return generic message — never expose raw internal error details to clients
    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 },
    );
  }
}

async function getInteractionById(id, loggedInUserId, timezone) {
  const inputParams = { interactionId: id, userId: loggedInUserId, timezone };
  return await executeStoredProcedure(
    "usp_GetInteractionById",
    inputParams,
    outputmsgWithStatusCodeParams,
  );
}

// Direct parameterized query — maps actual DB column names to InteractionsModel fields
async function getInteractionDirect(interactionId) {
  try {
    const pool = await connectToDatabase();
    const currentYear = new Date().getFullYear();
    const years = Array.from(
      { length: currentYear - 2022 + 2 },
      (_, i) => currentYear + 1 - i,
    );
    const tables = years.map((y) => `TblMst_Metadata_${y}`);

    for (const tableName of tables) {
      try {
        assertSafeTableName(tableName);
        const hasOrgId = tableName === "TblMst_Metadata";
        const orgIdSelect = hasOrgId
          ? 'm."OrganizationID" AS "organizationId"'
          : 'NULL AS "organizationId"';
        const orgNameSelect = hasOrgId
          ? 'o.org_name AS "organizationName"'
          : 'NULL AS "organizationName"';
        const joinClause = hasOrgId
          ? 'LEFT JOIN public.tblmst_organizations o ON m."OrganizationID" = o."Id"'
          : "";

        const result = await pool.query(
          `
          SELECT
            m.interaction_id   AS id,
            m.call_id          AS "callId",
            m.ucid,
            m.ani,
            m.extension,
            m.audio_start_time AS "audioStartTime",
            m.audio_end_time   AS "audioEndTime",
            m.personal_name    AS "personalName",
            m.agent_id         AS "agentId",
            NULL               AS agent,
            m.audio_module_no  AS "audioModuleNo",
            m.audio_ch_no      AS "audioChannelNo",
            m.local_start_time AS "localStartTime",
            m.local_end_time   AS "localEndTime",
            m.direction,
            m.number_of_holds  AS "noOfHolds",
            m.total_hold_time  AS "totalHoldTime",
            m.pbx_login_id     AS "pbxLoginId",
            m.duration,
            m.dnis_code        AS dnis,
            m.screens_exists   AS "screenExists",
            m.screens_module   AS "screenModule",
            m.switch_id        AS "switchId",
            m.switch_call_id   AS "switchCallId",
            m.switch_name      AS "switchName",
            m.file_location    AS "fileLocation",
            m.file_source_type AS "fileSourceType",
            NULL               AS "s3StorageClass",
            m.sid,
            ${orgIdSelect},
            ${orgNameSelect},
            NULL               AS "userId",
            NULL               AS user_full_name,
            NULL               AS evaluation_date,
            NULL               AS form_name,
            NULL               AS "FormUniqueId",
            0                  AS "EvaluationCount",
            m.transcriptionfilepath,
            m.transcription_source_type,
            m.transcription_status,
            m."Platformid",
            m.appid
          FROM public."${tableName}" m
          ${joinClause}
          WHERE CAST(m.interaction_id AS VARCHAR(100)) = $1
        `,
          [String(interactionId)],
        );

        if (result.rows && result.rows.length > 0) {
          return await setInteractions(result.rows);
        }
      } catch (tableErr) {
        // Table may not exist or other queries error — try next
        logWarning(
          `getInteractionDirect tableName=${tableName}`,
          tableErr.message,
          { interactionId },
        );
      }
    }
    return null;
  } catch (err) {
    logError("api/interactions/[id] GET id=" + interactionId, err);
    return null;
  }
}
