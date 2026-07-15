// app/api/roleManagement/edit/[id]/route.js

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

// 🧠 Add smartCapitalize here too
const smartCapitalize = (str) => {
  if (!str) return "";
  return str
    .split(" ")
    .map((word) => {
      if (word === word.toUpperCase()) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
};

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;

    if (!isValidPositiveInteger(resolvedParams?.id)) {
      await logWarning("POST /api/roleManagement/edit/[id]", {
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
    const roleId = parseInt(resolvedParams.id);

    if (isInvalid(roleId)) {
      await logWarning("POST /api/roleManagement/edit/[id]", {
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
    if (!isSuperAdmin && isSuperAdminRoleId(roleId)) {
      await logWarning("POST /api/roleManagement/edit/[id]", {
        message: "You are not allowed to edit Super Admin role.",
        roleId,
      });
      return NextResponse.json(
        {
          success: false,
          message: "You are not allowed to edit Super Admin role.",
          statusCode: 403,
        },
        { status: 403 },
      );
    }

    const body = await request.json();
    let { user_role, Description, ModifiedBy, userName } = body;

    if (!user_role?.trim()) {
      await logWarning("POST /api/roleManagement/edit/[id]", {
        message: "Role name cannot be empty.",
        roleId,
        ModifiedBy,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Role name cannot be empty.",
          statusCode: 200,
        },
        { status: 200 },
      );
    }

    // Apply smartCapitalize to name & description
    user_role = smartCapitalize(user_role);
    if (Description) Description = smartCapitalize(Description);

    const result = await updateRoleById(
      roleId,
      user_role,
      Description,
      ModifiedBy,
    );
    const { StatusCode, Message } = result.recordset[0];

    if (StatusCode === 200) {
      await logAudit({
        userId: ModifiedBy,
        userName: userName,
        actionType: "ROLE_UPDATED",
        description: `${userName} updated the role '${user_role}'`,
      });

      await logSuccess("POST /api/roleManagement/edit/[id]", {
        message: Message || "Role updated successfully",
        roleId,
        ModifiedBy,
      });
    } else {
      await logWarning("POST /api/roleManagement/edit/[id]", {
        message: Message || "Role update failed.",
        roleId,
        ModifiedBy,
        StatusCode,
      });
    }

    return NextResponse.json(
      {
        success: StatusCode === 200,
        message: Message,
        statusCode: StatusCode,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in EDIT role API:", error);
    logError("POST /api/roleManagement/edit/[id]", error);
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

async function updateRoleById(id, user_role, Description, ModifiedBy) {
  try {
    const inputParams = {
      RoleIdToUpdate: id,
      RoleName: user_role,
      RoleDescription: Description || "",
      ModifiedBy: ModifiedBy || null, // ✅ new parameter
    };

    return await executeStoredProcedure(
      "usp_UpdateRole",
      inputParams,
      outputmsgWithStatusCodeParams,
    );
  } catch (error) {
    console.error("Error executing usp_UpdateRole:", error);
    logError("roleManagement/edit/[id]/route.js:updateRoleById", error);
    throw error;
  }
}
