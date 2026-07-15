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
    const timezone = request.headers.get("timezone") || null;

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        {
          message: "LoggedInUserId header is missing, undefined, or invalid.",
        },
        { status: 400 }
      );
    }

    const result = await getEvaluationPassFailDetails(loggedInUserId, timezone);

    const message =
      result?.output?.outputmsg || "No message from stored procedure";

    const [summary = {}, details = []] = result?.recordsets || [];

    const statusCode =
      typeof result?.output?.statuscode === "number" &&
      result.output.statuscode > 0
        ? result.output.statuscode
        : 200;

    return NextResponse.json(
      {
        message,
        summary,
        details,
      },
      { status: statusCode }
    );
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      {
        message: error.message || "Internal server error.",
      },
      { status: 500 }
    );
  }
}

async function getEvaluationPassFailDetails(currentUserId, timezone = null) {
  const inputParams = {
    currentUserId,
    timezone, // passed even if null — the SP will fallback to UTC
  };

  try {
    const result = await executeStoredProcedure(
      "usp_GetEvaluationPassFailDetails",
      inputParams,
      outputmsgWithStatusCodeParams
    );
    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error("Failed to retrieve evaluation data from the database.");
  }
}
