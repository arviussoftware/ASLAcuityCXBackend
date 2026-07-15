import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

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
    const result = await getUsersPerRole(loggedInUserId, timezone);
    if (result?.recordsets?.length > 0) {
      const Data = result.recordsets[0];

      return NextResponse.json(
        {
          message: result.output.outputmsg,
          data: Data,
        },
        { status: result.output.statuscode }
      );
    }
    return NextResponse.json(
      { message: result.output.outputmsg },
      { status: result.output.statuscode }
    );
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

async function getUsersPerRole(currentUserId, timezone) {
  const inputParams = {
    currentUserId,
    timezone: timezone,
  };

  try {
    const result = await executeStoredProcedure(
      "usp_GetUsersRecentActivityFeed",
      inputParams,
      outputmsgWithStatusCodeParams
    );
    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error(
      "Failed to retrieve user status chart data from the database."
    );
  }
}
