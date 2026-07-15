import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { getAuditUser, logAudit } from "@/lib/auditLogger";
import { isInvalid } from "@/lib/generic";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request, { params }) {
  try {
    const formIdToDelete = parseInt(params.id);
    const authHeader = request.headers.get("authorization");

    // 🔐 Step 2: Check if token is missing or incorrect
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
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

    if (isInvalid(formIdToDelete)) {
      return NextResponse.json(
        {
          success: false,
          message: "Request body or parameter could not be read properly.",
        },
        { status: 400 }
      );
    }

    const { currentUserId, formName } = await request.json();

    if (isInvalid(currentUserId)) {
      return NextResponse.json(
        { success: false, message: "currentUserId is required." },
        { status: 400 }
      );
    }

    const hasDeletePermission = await checkUserPrivilege(
      currentUserId,
      MODULES.FORM_DESIGNER,
      PRIVILEGES.DELETE
    );

    if (!hasDeletePermission) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: No permission to delete forms." },
        { status: 403 }
      );
    }

    // Delete form by ID
    const result = await deleteFormById(formIdToDelete);
    const { StatusCode, Message } = result.recordset[0]; // Assuming a single record is returned

    if (StatusCode === 200) {
      const auditUser = await getAuditUser(currentUserId);

      await logAudit({
        userId: auditUser.userId,
        userName: auditUser.userName,
        actionType: "FORM_DELETED",
        description: `Deleted form '${formName || formIdToDelete}'.`,
      });

      return NextResponse.json(
        { success: true, message: Message },
        { status: 200 }
      );
    } else if (StatusCode === 404) {
      return NextResponse.json(
        { success: false, message: Message },
        { status: 404 }
      );
    } else {
      return NextResponse.json(
        { success: false, message: Message },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error in DELETE request:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

async function deleteFormById(id) {
  const inputParams = {
    formIdToDelete: id,
  };

  const result = await executeStoredProcedure(
    "usp_DeleteForm",
    inputParams,
    outputmsgWithStatusCodeParams
  );
  return result;
}
