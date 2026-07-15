import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract headers and query params
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);
    const dateFilterType = searchParams.get("dateFilterType"); // daily, weekly, monthly
    const timezone = request.headers.get("timezone");

    // Validate user ID
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "loggedInUserId header is missing or invalid." },
        { status: 400 }
      );
    }

    // Validate filter type
    if (!["daily", "weekly", "monthly"].includes(dateFilterType)) {
      return NextResponse.json(
        { message: "Invalid or missing dateFilterType query parameter." },
        { status: 400 }
      );
    }

    // Execute the stored procedure
    const result = await executeStoredProcedure(
      "usp_FormCreationTrend",
      {
        currentUserId: loggedInUserId,
        dateFilterType: dateFilterType,
        timezone: timezone,
      },
      outputmsgWithStatusCodeParams
    );

    const trendData = result?.recordsets?.[0] ?? [];

    return NextResponse.json(
      {
        message: result.output.outputmsg,
        data: trendData,
      },
      { status: result.output.statuscode }
    );
  } catch (error) {
    console.error("Error fetching trend data:", error);
    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 }
    );
  }
}
