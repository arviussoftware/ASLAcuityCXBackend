// app/api/interactions/route.js
import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  TotalRecords,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
const CHANNEL_TYPE_ID_BY_KEY = {
  telephony: "1",
  chat: "2",
  email: "3",
  social: "4",
};

const normalizeChannelTypeFilter = (channelTypeFilters) => {
  if (!Array.isArray(channelTypeFilters)) {
    return null;
  }

  const normalized = channelTypeFilters
    .map((item) => {
      const rawValue =
        item?.channelTypeId ??
        item?.channelType ??
        item?.value ??
        item?.id ??
        null;

      if (rawValue === null || rawValue === undefined || rawValue === "") {
        return null;
      }

      const stringValue = String(rawValue).trim();

      if (/^\d+$/.test(stringValue)) {
        return { channelType: stringValue };
      }

      const normalizedKey = stringValue.toLowerCase().replace(/[\s_-]+/g, "");
      const mappedId = CHANNEL_TYPE_ID_BY_KEY[normalizedKey];

      return mappedId
        ? { channelType: mappedId }
        : { channelType: stringValue };
    })
    .filter(Boolean);

  return normalized.length > 0 ? normalized : null;
};

const toStatusCode = (value, fallback = 500) => {
  const statusCode = Number(value);
  return Number.isFinite(statusCode) ? statusCode : fallback;
};

const getInteractionResponsePayload = async (result) => {
  const statusCode = toStatusCode(result?.output?.statuscode, 500);
  const message = String(result?.output?.outputmsg ?? "Unknown response.");
  const recordsets = Array.isArray(result?.recordsets) ? result.recordsets : [];
  const interactions = Array.isArray(recordsets[0]) ? recordsets[0] : [];
  const hasSecondRecordset = Array.isArray(recordsets[1]);
  const totalRecord = hasSecondRecordset
    ? await TotalRecords(recordsets[1])
    : interactions.length;

  return { statusCode, message, recordsets, interactions, totalRecord };
};

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");

    const body = await request.json();

    const {
      pageNo = 1,
      rowCountPerPage = 10,
      search = null,
      fromDate = null,
      toDate = null,
      organizationIds = null,
      agentNameIds = null,
      instanceNameIds = null,
      platformIds = null,
      channelTypeIds = null,
      extensions = null,
      callId = null,
      ucid = null,
      agent = null,
      formIds = null,
      evaluatorIds = null,
      durationOperator = null,
      durationValue = null,
      durationValue2 = null,
      aniDni = null,
      currentUserId,
      timezone = null,
      queryType = 0,
      ActiveStatus = 0,
      privilegeId = 0,
    } = body;
    const headerOrgIds =
      request.headers.get("orgIds") || request.headers.get("orgId") || null;
    const bodyOrgIds = Array.isArray(organizationIds)
      ? organizationIds
          .map((item) => {
            const orgId =
              item?.organizationId ?? item?.orgId ?? item?.OrganizationId;
            return orgId === undefined || orgId === null || orgId === ""
              ? null
              : String(orgId).trim();
          })
          .filter(Boolean)
          .join(",")
      : null;
    const privilegeOrgIds = headerOrgIds || bodyOrgIds || null;

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      await logWarning(
        "POST /api/interactions",
        "Missing or invalid Authorization header",
      );
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
      await logWarning("POST /api/interactions", "Invalid API token");
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    if (isInvalid(currentUserId)) {
      await logWarning("POST /api/interactions", "Invalid currentUserId", {
        currentUserId,
      });
      return NextResponse.json(
        { message: "Request body could not be read properly." },
        { status: 400 },
      );
    }

    const hasViewPermission = await checkUserPrivilege(
      currentUserId,
      MODULES.INTERACTION,
      PRIVILEGES.VIEW,
      privilegeOrgIds,
    );

    if (!hasViewPermission) {
      await logWarning(
        "POST /api/interactions",
        "User lacks permission to view interactions.",
        { currentUserId, privilegeId },
      );
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: No permission to view interaction.",
        },
        { status: 403 },
      );
    }

    const organizationIdsJSON = organizationIds
      ? JSON.stringify(organizationIds)
      : null;
    const agentNameIdsJSON = agentNameIds ? JSON.stringify(agentNameIds) : null;
    const instanceNameIdsJSON = instanceNameIds
      ? JSON.stringify(instanceNameIds)
      : null;
    const platformIdsJSON = platformIds ? JSON.stringify(platformIds) : null;
    const normalizedChannelTypeIds = normalizeChannelTypeFilter(channelTypeIds);
    const channelTypeIdsJSON = normalizedChannelTypeIds
      ? JSON.stringify(normalizedChannelTypeIds)
      : null;

    const result = await getInteractions(
      pageNo,
      rowCountPerPage,
      search,
      fromDate,
      toDate,
      organizationIdsJSON,
      agentNameIdsJSON,
      instanceNameIdsJSON,
      platformIdsJSON,
      channelTypeIdsJSON,
      extensions,
      callId,
      ucid,
      agent,
      formIds,
      evaluatorIds,
      durationOperator,
      durationValue,
      durationValue2,
      aniDni,
      currentUserId,
      timezone,
      queryType,
      ActiveStatus,
      privilegeId,
    );

    const { statusCode, message, recordsets, interactions, totalRecord } =
      await getInteractionResponsePayload(result);

    if (statusCode === 404) {
      await logWarning(
        "POST /api/interactions",
        "Year partition table missing in database.",
        { statusCode, message, queryType, currentUserId, fromDate, toDate },
      );
      return NextResponse.json(
        { message, totalRecord: 0, interactions: [] },
        { status: 200 },
      );
    }

    if (statusCode === 204) {
      await logWarning(
        "POST /api/interactions",
        "No records found for the selected filters.",
        { statusCode, queryType, currentUserId, fromDate, toDate },
      );
      return NextResponse.json(
        { message, totalRecord: 0, interactions: [] },
        { status: 200 },
      );
    }

    if (statusCode >= 400 && statusCode < 500) {
      await logWarning("POST /api/interactions", message, {
        statusCode,
        queryType,
        currentUserId,
      });

      return NextResponse.json(
        {
          message,
          totalRecord: 0,
          interactions: [],
        },
        { status: statusCode },
      );
    }

    if (statusCode >= 500) {
      await logError("POST /api/interactions", new Error(message), {
        statusCode,
        queryType,
        currentUserId,
      });
      return NextResponse.json({ message }, { status: statusCode });
    }

    if (recordsets.length === 0) {
      await logWarning(
        "POST /api/interactions",
        "Stored procedure returned 200 but no recordsets were found.",
        { statusCode, queryType, currentUserId },
      );
    } else if (recordsets.length === 1 && queryType === 0) {
      await logWarning(
        "POST /api/interactions",
        "Stored procedure returned a single recordset for a paginated interaction query.",
        { statusCode, queryType, currentUserId },
      );
    }

    if (queryType === 0) {
      await logSuccess(
        "POST /api/interactions",
        "Interactions fetched successfully.",
        {
          statusCode,
          queryType,
          currentUserId,
          totalRecord,
          interactionCount: interactions.length,
        },
      );
      return NextResponse.json(
        {
          message,
          totalRecord,
          interactions,
        },
        { status: statusCode },
      );
    }

    await logSuccess(
      "POST /api/interactions",
      "Interactions fetched successfully.",
      {
        statusCode,
        queryType,
        currentUserId,
        interactionCount: interactions.length,
      },
    );

    return NextResponse.json(
      {
        message,
        interactions,
      },
      { status: statusCode },
    );
  } catch (error) {
    await logError("POST /api/interactions", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

async function getInteractions(
  pageNo,
  rowCountPerPage,
  search,
  fromDate,
  toDate,
  organizationIds,
  agentNameIds,
  instanceNameIds,
  platformIds,
  channelTypeIds,
  extensions,
  callId,
  ucid,
  agent,
  formIds,
  evaluatorIds,
  durationOperator,
  durationValue,
  durationValue2,
  aniDni,
  loggedInUserId,
  timezone,
  queryType,
  ActiveStatus,
  privilegeId,
) {
  const inputParams = {
    pageNo,
    rowCountPerPage,
    search,
    fromDate,
    toDate,
    organizationIds,
    agentNameIds,
    instanceNameIds,
    platformIds,
    channelTypeIds,
    extensions,
    callId,
    ucid,
    agent,
    formids: formIds,
    evaluatorids: evaluatorIds,
    durationOperator,
    durationValue,
    durationValue2,
    aniDni,
    userId: loggedInUserId,
    timezone,
    querytype: queryType,
    ActiveStatus,
    privilegeId,
  };

  try {
    const result = await executeStoredProcedure(
      "usp_getinteractions_newyearwise",
      inputParams,
      outputmsgWithStatusCodeParams,
    );

    return result;
  } catch (err) {
    await logError("getInteractions -> usp_getinteractions_newyearwise", err);
    console.error(
      "[SP Error] Error executing stored procedure:",
      err.message,
      err.stack,
    );
    throw err;
  }
}
