import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql";
import { isInvalid } from "@/lib/generic";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {toSave, toDelete, userId } = body;

    const hasPermission = await checkUserPrivilege(
      userId,
      MODULES.ORGANIZATION_FORM_MAPPING,
      PRIVILEGES.VIEW
    );

    if (!hasPermission) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: You do not have permission.",
        },
        { status: 403 }
      );
    }

    const spResult = await insertMappings({
      toSave: toSave,
      toDelete :toDelete,
      createdBy: userId,
    });

    const statusCode = parseInt(spResult.output?.statuscode || 500);
    const message = spResult.output?.outputmsg || "Unknown error occurred";

    return NextResponse.json(
      { success: statusCode === 200, message },
      { status: statusCode }
    );
  } catch (error) {
    console.error("Mapping save failed:", error);
    return NextResponse.json(
      { success: false, message: "Server Error: " + error.message },
      { status: 500 }
    );
  }
}

async function insertMappings({ toSave,toDelete, createdBy }) {
  const inputParams = {
    toSave: JSON.stringify(toSave),
    toDelete: JSON.stringify(toDelete), // 💥 CONVERT TO JSON STRING
    createdBy,
  };
  const result = await executeStoredProcedure(
    "usp_InsertRoleOrgFormMapping",
    inputParams,
    outputmsgWithStatusCodeParams
  );
  return result;
}
