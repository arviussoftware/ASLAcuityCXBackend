import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const filterType = url.searchParams.get("filterType");
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"));
    const timezone = request.headers.get("timezone");

    if (isInvalid(filterType) || isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Missing or invalid filterType or loggedInUserId" },
        { status: 400 }
      );
    }

    const result = await executeStoredProcedure(
      "usp_LiveFormActivityFeed",
      {
        filterType,
        currentUserId: loggedInUserId,
        timezone,
      },
      outputmsgWithStatusCodeParams
    );

    const activityFeed = result?.recordsets?.[0] ?? [];

    return NextResponse.json(
      {
        message: result.output.outputmsg,
        data: activityFeed,
      },
      { status: result.output.statusCode }
    );
  } catch (error) {
    console.error("Error in Live Activity Feed API:", error);
    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 }
    );
  }
}
