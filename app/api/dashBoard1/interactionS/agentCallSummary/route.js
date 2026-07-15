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

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "LoggedInUserId header is missing, undefined, or invalid." },
        { status: 400 }
      );
    }

    const result = await getAgentCallSummary(loggedInUserId);
    const statusCode = result?.output?.statuscode || 500; // fix: lowercase 'statuscode'
    const message = result?.output?.outputmsg || "No message from stored procedure";
    const data = result?.recordset || []; // fix: use recordset for multiple rows

    return NextResponse.json(
      {
        message,
        data,
      },
      { status: statusCode }
    );
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { message: error.message || "Internal server error." },
      { status: 500 }
    );
  }
}

async function getAgentCallSummary(currentUserId) {
  const inputParams = {
    currentUserId,
  };

  try {
    const result = await executeStoredProcedure(
      "usp_AgentWiseCallSummary",
      inputParams,
      outputmsgWithStatusCodeParams
    );
    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error("Failed to retrieve call evaluation metrics from the database.");
  }
}
