// app\api\reports\organizationAvgEvaluation\route.js

import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { isInvalid } from "@/lib/generic";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);
    const orgIds = request.headers.get("orgIds") || request.headers.get("orgId");
    const timezone = request.headers.get("timezone");
    const {
      filter,
      StartDate,
      EndDate,
      formIds,
      organizationIds,
      agentIds,
      pageNo,
      rowCountPerPage,
      queryType,
    } = await request.json();

    const parameters = {
      userId: loggedInUserId, // <-- Add this line
      DateFilter: filter,
      StartDate: StartDate,
      EndDate: EndDate,
      FormIds: Array.isArray(formIds) ? formIds.join(",") : formIds,
      OrganizationIds: Array.isArray(organizationIds)
        ? organizationIds.join(",")
        : organizationIds,
      AgentIds: Array.isArray(agentIds) ? agentIds.join(",") : agentIds,
      PageNo: pageNo,
      RowCountPerPage: rowCountPerPage,
      QueryType: queryType,
      timezone: timezone,
    };

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Logged-in user ID is missing or invalid." },
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

    const data = await executeStoredProcedure(
      "usp_GetNumberOfEvaluationsByAgent",
      parameters
    );

    // Handle different response formats based on queryType
    if (queryType === 0) {
      // Return both data and total count
      const NumberOfEvaluationsByAgent = data.recordsets[0];
      const totalCount = data.recordsets[1][0].TotalCount;

      return NextResponse.json({
        success: true,
        message: "Data fetched successfully",
        data: {
          NumberOfEvaluationsByAgent: NumberOfEvaluationsByAgent,
          totalCount: totalCount,
        },
      });
    } else if (queryType === 1) {
      // Return only the data without total count
      const NumberOfEvaluationsByAgent = data.recordsets[0];

      return NextResponse.json({
        success: true,
        message: "Data fetched successfully",
        data: {
          NumberOfEvaluationsByAgent: NumberOfEvaluationsByAgent,
        },
      });
    } else {
      return NextResponse.json(
        { success: false, message: "Invalid queryType specified" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error occurred while fetching data:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
