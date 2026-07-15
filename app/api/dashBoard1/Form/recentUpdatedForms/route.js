import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"));
    const timezone = request.headers.get("timezone"); // ✅ Needed now

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Missing or invalid loggedInUserId" },
        { status: 400 }
      );
    }
    const result = await executeStoredProcedure(
      "usp_RecentlyUpdatedForms",
      {
        currentUserId: loggedInUserId,
        timezone,
      },
      outputmsgWithStatusCodeParams
    );

    const updatedForms = result?.recordsets?.[0] ?? [];

    return NextResponse.json(
      {
        message: result.output.outputmsg,
        data: updatedForms,
      },
      { status: result.output.statuscode }
    );
  } catch (error) {
    console.error("Error in Recently Updated Forms API:", error);
    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 }
    );
  }
}
