// app/api/dashboard/[id]/route.js

import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import { executeStoredProcedure, TotalRecords, outputmsgWithStatusCodeParams } from "@/lib/sql.js";

export async function POST(request) {
  try {
    const { userId } = await request.json();
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);

    if (isInvalid(userId) || isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Headers are missing or invalid parameters." },
        { status: 400 }
      );
    }
    const dashboardDetails = await getUserDashboardData(loggedInUserId, userId);

    if (dashboardDetails?.recordsets?.length > 0) {
      const userCardData = dashboardDetails.recordsets[2];
      const userCallChartData = dashboardDetails.recordsets[0];
      const userFormChartData = dashboardDetails.recordsets[1];
      const userHoverModelData = dashboardDetails.recordsets[3];
      
      return NextResponse.json(
        {
          message: dashboardDetails.output.outputmsg,
          userCallChartData,
          userCardData,
          userFormChartData,
          userHoverModelData,
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

async function getUserDashboardData(currentUserId, userId) {
  const inputParams = {
    currentUserId,
    userId
  };

  const result = await executeStoredProcedure(
    "usp_GetDashboardById",
    inputParams,
    outputmsgWithStatusCodeParams
  );

  return result;
}
