import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);
    const timezone = request.headers.get("timezone"); // ✅ Get timezone from headers

    const { searchParams } = new URL(request.url);

    // read filters from query
    const statusFilter = searchParams.get("statusFilter") || "Total";
    const dateFilter = searchParams.get("dateFilter") || "All";

    // Validation: User ID
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Missing or invalid 'loggedInUserId' in request headers." },
        { status: 400 }
      );
    }

    const validStatusFilters = ["Total", "Passed", "Failed"];
    const validDateFilters = ["All", "Daily", "Weekly", "Monthly"];

    if (!validStatusFilters.includes(statusFilter)) {
      return NextResponse.json(
        { message: "Query parameter 'statusFilter' must be one of: Total, Passed, Failed." },
        { status: 400 }
      );
    }

    if (!validDateFilters.includes(dateFilter)) {
      return NextResponse.json(
        { message: "Query parameter 'dateFilter' must be one of: All, Daily, Weekly, Monthly." },
        { status: 400 }
      );
    }

    // call SP with correct param names
    const result = await getEvaluationDetailsByStatus(loggedInUserId, statusFilter, dateFilter,timezone);
    const statusCode = parseInt(result?.output?.statusCode) || 200;
    const message = result?.output?.outputmsg || "Fetched successfully";

    return NextResponse.json(
      {
        message,
        data: result?.recordset || [],
      },
      { status: statusCode }
    );
  } catch (error) {
    console.error("API Error (GET Evaluation Details):", error);
    return NextResponse.json(
      {
        message: "Internal server error",
        error: error.message,
      },
      { status: 500 }
    );
  }
}

async function getEvaluationDetailsByStatus(currentUserId, statusFilter, dateFilter,timezone) {
  try {
    return await executeStoredProcedure(
      "usp_GetEvaluationDetailsByStatus",
      { currentUserId, statusFilter, dateFilter ,timezone}, // correct param names
      outputmsgWithStatusCodeParams
    );
  } catch (error) {
    console.error("Stored Procedure Error:", error);
    throw new Error("Could not fetch evaluation details.");
  }
}
