export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import { executeStoredProcedure, outputmsgWithStatusCodeParams } from "@/lib/sql.js";

export async function GET(request) {
  try {
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "LoggedInUserId header is missing, undefined, or invalid." },
        { status: 400 }
      );
    }

    const result = await getCallEvaluationMetrics(loggedInUserId);
    const statusCode = result?.output?.statuscode || 500;
    const message = result?.output?.outputmsg || "No message from stored procedure";

    const data = result?.recordsets?.[0]?.[0] || null;

    return NextResponse.json(
      {
        message,
        data,
      },
      { status: statusCode }
    );
  } catch (error) {
    return NextResponse.json(
      { message: error.message || "Internal server error." },
      { status: 500 }
    );
  }
}

// Function to fetch the call evaluation metrics
async function getCallEvaluationMetrics(currentUserId) {
  const inputParams = {
    currentUserId,
  };

  try {
    const result = await executeStoredProcedure(
      "usp_CallEvaluationMetrics",
      inputParams,
      outputmsgWithStatusCodeParams
    );
    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error("Failed to retrieve call evaluation metrics from the database.");
  }
}
