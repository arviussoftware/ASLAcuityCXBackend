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
    const timezone = request.headers.get("timezone");

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "LoggedInUserId header is missing, undefined, or invalid." },
        { status: 400 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const fromDateParam = searchParams.get("fromDate");
    const toDateParam = searchParams.get("toDate");
    const groupBy = searchParams.get("groupBy") || "Daily";

    // Sanitize dates if needed
    const fromDate =
      fromDateParam && !isNaN(Date.parse(fromDateParam)) ? fromDateParam : null;
    const toDate =
      toDateParam && !isNaN(Date.parse(toDateParam)) ? toDateParam : null;

    const { data, output } = await getCallVolumeTrends(
      fromDate,
      toDate,
      groupBy,
      timezone,
      loggedInUserId
    );

    if (!data || data.length === 0) {
      return NextResponse.json(
        { message: "No data found for the specified filters." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        message: output?.outputmsg || "Success",
        data: data,
      },
      { status: output?.statuscode || 200 }
    );
  } catch (error) {
    console.error("API Error:", error.message);
    return NextResponse.json(
      { message: error.message || "An unexpected error occurred." },
      { status: 500 }
    );
  }
}

async function getCallVolumeTrends(
  fromDate,
  toDate,
  groupBy,
  timezone,
  currentUserId
) {
  const inputParams = {
    currentUserId,
    fromDate: fromDate,
    toDate: toDate,
    groupBy: groupBy,
    timezone: timezone,
  };

  try {
    const { recordset, output } = await executeStoredProcedure(
      "usp_GetCallVolumeTrends",
      inputParams,
      outputmsgWithStatusCodeParams
    );

    return { data: recordset, output };
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error("Failed to retrieve call volume trends from the database.");
  }
}
