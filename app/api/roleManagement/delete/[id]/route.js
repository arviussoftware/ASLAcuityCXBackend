import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logAudit } from "@/lib/auditLogger";
import { isInvalid, isValidPositiveInteger } from "@/lib/generic";
import {
  isSuperAdminFromRequest,
  isSuperAdminRoleId,
} from "@/lib/auth/superAdmin";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;

    if (!isValidPositiveInteger(resolvedParams?.id)) {
      await logWarning("POST /api/roleManagement/delete/[id]", {
        message: "Invalid or missing role ID.",
      });
      return NextResponse.json(
        {
          success: false,
          message: "Invalid or missing role ID.",
          statusCode: 400,
        },
        { status: 400 },
      );
    }

    const RoleIdToDelete = parseInt(resolvedParams.id);

    if (isInvalid(RoleIdToDelete)) {
      await logWarning("POST /api/roleManagement/delete/[id]", {
        message: "Invalid or missing role ID.",
      });
      return NextResponse.json(
        {
          success: false,
          message: "Invalid or missing role ID.",
          statusCode: 400,
        },
        { status: 400 },
      );
    }

    const isSuperAdmin = await isSuperAdminFromRequest();
    if (!isSuperAdmin && isSuperAdminRoleId(RoleIdToDelete)) {
      await logWarning("POST /api/roleManagement/delete/[id]", {
        message: "You are not allowed to delete Super Admin role.",
        RoleIdToDelete,
      });
      return NextResponse.json(
        {
          success: false,
          message: "You are not allowed to delete Super Admin role.",
          statusCode: 403,
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { userId, userName, roleName } = body;

    const result = await deleteRoleById(RoleIdToDelete);

    // ✅ Postgres path returns `result.output`, not `result.recordset[0]`
    // ✅ keys are lowercase: `statuscode` / `outputmsg` (set in sql.js's buildOutput)
    const StatusCode = result.output?.statuscode;
    const Message = result.output?.outputmsg;

    // ⭐ AUDIT LOG
    if (StatusCode === 200) {
      await logAudit({
        userId: userId,
        userName: userName,
        actionType: "ROLE_DELETED",
        description: `${userName} deleted the role '${roleName}'`,
      });

      await logSuccess("POST /api/roleManagement/delete/[id]", {
        message: Message || "Role deleted successfully",
        RoleIdToDelete,
        userId,
      });
    } else {
      await logWarning("POST /api/roleManagement/delete/[id]", {
        message: Message || "Role deletion failed.",
        RoleIdToDelete,
        userId,
        StatusCode,
      });
    }

    return NextResponse.json(
      {
        success: StatusCode === 200,
        message: Message,
        statusCode: StatusCode, // ✅ include this like organization
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in DELETE role API:", error);
    logError("POST /api/roleManagement/delete/[id]", error);
    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
        statusCode: 500,
      },
      { status: 500 },
    );
  }
}

async function deleteRoleById(id) {
  try {
    const inputParams = {
      RoleIdToDelete: id,
    };

    return await executeStoredProcedure(
      "usp_DeleteRole",
      inputParams,
      outputmsgWithStatusCodeParams,
    );
  } catch (error) {
    console.error("Error executing usp_DeleteRole:", error);
    logError("roleManagement/delete/[id]/route.js:deleteRoleById", error);
    throw error;
  }
}
