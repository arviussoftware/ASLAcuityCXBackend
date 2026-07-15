import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const loggedInUserIdHeader = request.headers.get("loggedInUserId");
    const loggedInUserId = parseInt(loggedInUserIdHeader || "", 10);

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Invalid or missing 'loggedInUserId' header." },
        { status: 400 }
      );
    }

    const result = await getFormUsageStatus(loggedInUserId);

    const statusCode = result?.output?.statuscode ?? 500;
    const message = result?.output?.outputmsg ?? "No message returned.";
    let data = result?.recordset ?? [];

    // Format all CallDate-like fields to remove time
    data = data.map((row) => {
      const newRow = { ...row };
      if (newRow.CallDate) {
        newRow.CallDate = formatDateOnly(newRow.CallDate);
      }
      return newRow;
    });

    return NextResponse.json({ message, data }, { status: statusCode });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { message: error.message || "Internal server error." },
      { status: 500 }
    );
  }
}

function formatDateOnly(dateValue) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  return date.toISOString().split("T")[0]; // Returns 'YYYY-MM-DD'
}




async function getFormUsageStatus(currentUserId) {
  const inputParams = {
    currentUserId,
  };

  try {
    return await executeStoredProcedure(
      "usp_EvaluationFormUsageStats",
      inputParams,
      outputmsgWithStatusCodeParams
    );
  } catch (error) {
    console.error("Stored Procedure Execution Error:", error);
    throw new Error("Database error while fetching form usage stats.");
  }
}
