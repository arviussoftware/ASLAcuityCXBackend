import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import {
  setAllFormInDDL,
  setFormWithSelectedStatusInDDL,
} from "@/lib/models/formDDL";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const loggedInUserId = request.headers.get("loggedInUserId");
    const reqType = request.headers.get("requestType");
    const interactionId = request.headers.get("interactionId");

    if (
      isInvalid(loggedInUserId) ||
      isInvalid(reqType) ||
      isInvalid(interactionId)
    ) {
      return NextResponse.json(
        {
          message:
            "Headers are missing or undefined or empty or can't pass wrong value.",
        },
        { status: 400 }
      );
    }

    const result = await getFormDDL(loggedInUserId, reqType, interactionId);

    const recordsetsCount = result.recordsets.length;
    if (recordsetsCount > 0) {
      const formList = await setFormWithSelectedStatusInDDL(
        result.recordsets[0]
      );
      return NextResponse.json(
        { message: "Success", formList },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        { message: result.output.outputmsg },
        { status: result.output.statuscode }
      );
    }
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

// To fetch the record from database.
async function getFormDDL(loggedInUserId, reqType, interactionId) {
  const inputParams = {
    currentUserid: loggedInUserId,
    type: reqType,
    interactionId: interactionId,
  };
  const result = await executeStoredProcedure(
    "usp_FormDDL",
    inputParams,
    outputmsgWithStatusCodeParams
  );
  return result;
}
