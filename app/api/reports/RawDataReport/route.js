import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { isInvalid } from "@/lib/generic";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");
    const orgIds = request.headers.get("orgIds") || request.headers.get("orgId");
    const timezone = request.headers.get("timezone");
    const body = await request.json();
    // const pageNo = parseInt(body.page || 1);
    // const rowCountPerPage = parseInt(body.perPage || 10);
    const formIds = body.formIds;
    const organizationIds = body.organizationIds;
    const agentIds = body.agentIds;
    const startDate = body.startDate;
    const endDate = body.endDate;
    const ActiveStatus = body.ActiveStatus;
    const filter = body.filter;

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 }
      );
    }

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Invalid or missing loggedInUserId." },
        { status: 400 }
      );
    }

    const hasViewPermission = await checkUserPrivilege(
      loggedInUserId,
      MODULES.REPORTS,
      PRIVILEGES.VIEW,
      orgIds || null
    );

    if (!hasViewPermission) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: No permission to view report.",
        },
        { status: 403 }
      );
    }
    if (isInvalid(formIds)) {
      return NextResponse.json(
        { message: "Invalid or missing formIds." },
        { status: 400 }
      );
    }

    const rawdata = await getrawdata(
      filter,
      loggedInUserId,
      formIds,
      organizationIds,
      agentIds,
      // pageNo,
      // rowCountPerPage,
      startDate,
      endDate,
      ActiveStatus,
      timezone
    );

    if (!rawdata.recordsets || rawdata.recordsets.length === 0) {
      return NextResponse.json(
        { success: false, message: "Raw data is not available." },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Raw data fetched successfully.",
        totalRecord: rawdata.recordsets[1]?.[0]?.TotalCount || 0,
        RawData: rawdata.recordsets[0], // direct return
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("Error occurred while processing POST request:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error." },
      { status: 500 }
    );
  }
}

async function getrawdata(
  filter,
  loggedInUserId,
  formIds,
  organizationIds,
  agentIds,
  // pageNo,
  // rowCountPerPage,
  startDate,
  endDate,
  ActiveStatus,
  timezone
) {
  try {
    const inputParams = {
      DateFilter: filter,
      userId: loggedInUserId,
      // pageNo,
      // rowCountPerPage,
      OrganizationIds: Array.isArray(organizationIds)
        ? organizationIds.join(",")
        : organizationIds || null,
      formIds: Array.isArray(formIds) ? formIds.join(",") : formIds || null,
      agentIds: Array.isArray(agentIds) ? agentIds.join(",") : agentIds || null,
      startDate,
      endDate,
      ActiveStatus,
      timezone,
    };

    const result = await executeStoredProcedure(
      "Usp_GetRawdataReport",
      inputParams,
      outputmsgWithStatusCodeParams
    );
    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw error;
  }
}
