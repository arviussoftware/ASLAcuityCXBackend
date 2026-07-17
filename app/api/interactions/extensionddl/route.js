import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logError } from "@/lib/errorLogger";
import { setExtenion } from "@/lib/models/extensionDDL";

export async function GET(request) {
  try {
    // Headers
    const fromDate = request.headers.get("fromDate");
    const toDate = request.headers.get("toDate");
    const loggedInUserId = request.headers.get("loggedInUserId");

    if (isInvalid(loggedInUserId) || isInvalid(fromDate) || isInvalid(toDate)) {
      return NextResponse.json(
        {
          message: "Headers are missing or undefined or empty.",
        },
        { status: 400 }
      );
    }

    const result = await getExtensionDDL(loggedInUserId, fromDate, toDate);
    const recordsetsCount = result.recordsets.length;
    var extensionList = [];
    if (recordsetsCount > 0) {
      extensionList = await setExtenion(result.recordsets[0]);
    }

    return NextResponse.json(
      { message: result.output.outputmsg, extensionList },
      { status: result.output.statuscode }
    );
  } catch (error) {
    await logError("GET /api/interactions/extensionddl", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

async function getExtensionDDL(loggedInUserId, fromDate, toDate) {
  const inputParams = {
    fromDate: fromDate,
    toDate: toDate,
    currentUserid: loggedInUserId,
  };
  const result = await executeStoredProcedure(
    "usp_ExtensionsDDLbyDateRange",
    inputParams,
    outputmsgWithStatusCodeParams
  );
  return result;
}
