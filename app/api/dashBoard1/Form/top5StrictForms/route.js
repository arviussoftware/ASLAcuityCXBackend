
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams
} from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"));

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Missing or invalid loggedInUserId" },
        { status: 400 }
      );
    }

    // Call the stored procedure: usp_Top5StrictForms
    const result = await executeStoredProcedure(
      "usp_Top5StrictForms",  
      { currentUserId: loggedInUserId },
      outputmsgWithStatusCodeParams
    );

    const topForms = result?.recordsets?.[0] ?? [];

    return NextResponse.json(
      {
        message: result.output.outputmsg,
        data: topForms
      },
      { status: result.output.statuscode }
    );
  } catch (error) {
    console.error("Error in Top 5 Strict Forms API:", error);
    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 }
    );
  }
}
