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
    const timezone = request.headers.get("timezone"); // ✅ Needed now

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "LoggedInUserId header is missing, undefined, or invalid." },
        { status: 400 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");
    const overdueDays = parseInt(searchParams.get("overdueDays") || "5", 10);

    const { data, output } = await getEvaluationSummary(
      fromDate,
      toDate,
      overdueDays,
      loggedInUserId,
      timezone // ✅ Now passed correctly
    );

    if (!data || data.length === 0) {
      return NextResponse.json(
        { message: "No data found for the specified filters." },
        { status: 404 }
      );
    }
    return NextResponse.json(
      {
        message: output.outputmsg || "Success",
        data,
      },
      { status: output.statuscode || 200 }
    );
  } catch (error) {
    console.error("API ERROR:", error.message);
    return NextResponse.json(
      { message: error.message || "An unexpected error occurred." },
      { status: 500 }
    );
  }
}

async function getEvaluationSummary(
  fromDate,
  toDate,
  overdueDays,
  currentUserId,
  timezone // ✅ Added
) {
  const inputParams = {
    fromDate: fromDate || null,
    toDate: toDate || null,
    overdueDays,
    currentUserId,
    timezone: timezone || null, // ✅ Passed to SP
  };
  try {
    const { recordset, output } = await executeStoredProcedure(
      "usp_GetEvaluationCompletionSummary",
      inputParams,
      outputmsgWithStatusCodeParams
    );
    return { data: recordset, output };
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error(
      "Failed to retrieve evaluation completion summary from the database."
    );
  }
}
