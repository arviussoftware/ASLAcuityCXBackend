import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  TotalRecords,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const body = await request.json();
    const page = parseInt(body.page); // Default to 1 if not provided
    const perPage = parseInt(body.perPage); // Default to 10 if not provided
    // const toDate = body.toDate || '2025-07-15';
    // const fromDate = body.fromDate || '2016-01-27';

    // Header
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);
    // 🔐 Step 2: Check if token is missing or incorrect
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
        { message: "Headers are missing or undefined or empty." },
        { status: 400 }
      );
    }
    const hasViewPermission = await checkUserPrivilege(
      loggedInUserId,
      MODULES.DASHBOARD,
      PRIVILEGES.VIEW
    );
    if (!hasViewPermission) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: No permission to view dashboard.",
        },
        { status: 403 }
      );
    }
    // Fetch dashboard data using helper function
    const dashboardDetails = await getDashboardData(
      page,
      perPage,
      loggedInUserId
    );

    if (dashboardDetails?.recordsets?.length > 0) {
      const tableRecord = dashboardDetails.recordsets[0];
      const totalRecord = dashboardDetails.recordsets[1]
        ? await TotalRecords(dashboardDetails.recordsets[1])
        : 0;
      const callChartData = dashboardDetails.recordsets[2];
      const cardData = dashboardDetails.recordsets[3];
      const hoverModelData = dashboardDetails.recordsets[4];
      const formChartData = dashboardDetails.recordsets[5];
      return NextResponse.json(
        {
          message: dashboardDetails.output.outputmsg,
          totalRecord,
          tableRecord,
          callChartData,
          cardData,
          hoverModelData,
          formChartData,
        },
        { status: dashboardDetails.output.statuscode }
      );
    }

    return NextResponse.json(
      { message: dashboardDetails.output.outputmsg },
      { status: dashboardDetails.output.statuscode }
    );
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

async function getDashboardData(pageNo, rowCountPerPage, currentUserId) {
  const inputParams = {
    pageNo,
    rowCountPerPage,
    currentUserId,
  };

  const result = await executeStoredProcedure(
    "usp_GetDashboardDetails",
    inputParams,
    outputmsgWithStatusCodeParams
  );

  return result;
}
