export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import { executeStoredProcedure, outputmsgWithStatusCodeParams } from "@/lib/sql.js";

export async function GET(request) {
  try {
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);

    // Validate user ID
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "LoggedInUserId header is missing, undefined, or invalid." },
        { status: 400 }
      );
    }

    // Call the procedure and pass userId
    const result = await getTopUserContributors(loggedInUserId);

    if (result?.recordsets?.length > 0) {
      const createdBy = result.recordsets[0] || [];
      const modifiedBy = result.recordsets[1] || [];

      return NextResponse.json(
        {
          message: result.output.outputmsg,
          createdBy,
          modifiedBy,
        },
        { status: result.output.statuscode }
      );
    }

    // Fallback response if no data
    return NextResponse.json(
      { message: result.output.outputmsg },
      { status: result.output.statuscode }
    );

  } catch (error) {
    console.error("Error in GET /api/getTopUserContributors:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

async function getTopUserContributors(currentUserId) {
  const inputParams = {
    currentUserId,
};
  try {
    const result = await executeStoredProcedure(
      "usp_GetTopUserContributors", 
      inputParams,
      outputmsgWithStatusCodeParams
    );
    return result;
  } catch (error) {
    console.error("Error executing usp_GetTopUserContributors:", error);
    throw new Error("Failed to retrieve top user contributors from the database.");
  }
}
