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
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate required headers (interactionId removed)
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        {
          message:
            "Headers are missing or undefined or empty or can't pass wrong value.",
        },
        { status: 400 }
      );
    }
    const hasViewPermission = await checkUserPrivilege(
      loggedInUserId,
      MODULES.REPORTS,
      PRIVILEGES.VIEW
    );
    if (!hasViewPermission) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: No permission to view report.",
        },
        { status: 403 }
      );
    }
    // Call the stored procedure without interactionId
    const result = await getFormDDL(loggedInUserId);

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

// To fetch the record from the database.
async function getFormDDL(loggedInUserId) {
  const inputParams = {
    currentUserid: loggedInUserId,
  };
  const result = await executeStoredProcedure(
    // "usp_FormDDL",
    "usp_FormDDL_NoInteraction",
    inputParams,
    outputmsgWithStatusCodeParams
  );

  return result;
}
