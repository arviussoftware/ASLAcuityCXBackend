export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export async function GET(request) {
  try {
    // Get the search params from the URL
    const { searchParams } = new URL(request.url);
    //Extract  timezone from hearsers
    const timezone = request.headers.get("timezone");
    // Extract headers and query params
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);
    let dateFilterType = searchParams.get("dateFilterType");
    if (
      !dateFilterType ||
      !["daily", "weekly", "monthly"].includes(dateFilterType)
    ) {
      dateFilterType = "daily"; // Default value
    }

    // Validate user ID
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "loggedInUserId header is missing or invalid." },
        { status: 400 }
      );
    }

    // Validate filter type (ensure it's one of the expected values)
    if (!["daily", "weekly", "monthly"].includes(dateFilterType)) {
      return NextResponse.json(
        { message: "Invalid or missing dateFilterType query parameter." },
        { status: 400 }
      );
    }

    // Prepare the parameters for the stored procedure
    const inputParams = {
      currentUserId: loggedInUserId,
      dateFilterType: dateFilterType,
      timezone: timezone,
    };

    // Execute the stored procedure to fetch the growth data
    const result = await executeStoredProcedure(
      "usp_GetUSerGrowth", // Check if the stored procedure name is correct
      inputParams,
      outputmsgWithStatusCodeParams
    );

    // Extract the result from the stored procedure
    const trendData = result?.recordsets?.[0] ?? [];

    // Return success response with data
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
