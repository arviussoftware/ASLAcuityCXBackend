import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
  connectToDatabase,
} from "@/lib/sql.js";
import { logAudit } from "@/lib/auditLogger";
import { isSuperAdminFromRequest } from "@/lib/auth/superAdmin";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

const smartCapitalize = (str) => {
  if (!str) return "";

  return str
    .split(" ")
    .map((word) => {
      if (word === word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
};

export async function POST(request) {
  try {
    const { newRole, Description, userId, userName } =
      await request.json();

    if (!newRole?.trim()) {
      await logWarning("POST /api/roleManagement/add", {
        message: "Role name is required.",
        userId,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Role name is required.",
        },
        { status: 400 }
      );
    }

    const formattedRole = smartCapitalize(newRole.trim());
    const formattedDesc = Description
      ? smartCapitalize(Description.trim())
      : "";

    const isSuperAdmin = await isSuperAdminFromRequest();

    if (
      !isSuperAdmin &&
      formattedRole.toLowerCase() === "super admin"
    ) {
      await logWarning("POST /api/roleManagement/add", {
        message: "You are not allowed to create Super Admin role.",
        userId,
        role: formattedRole,
      });
      return NextResponse.json(
        {
          success: false,
          message:
            "You are not allowed to create Super Admin role.",
        },
        { status: 403 }
      );
    }

    const result = await CreateRole(
      formattedRole,
      formattedDesc,
      userId
    );

    const statusCode = Number(
      result?.output?.statuscode || 500
    );

    const message =
      result?.output?.outputmsg ||
      "Failed to create role.";

    if (statusCode === 200) {
      let newRoleData =
        result?.recordset?.[0] ||
        result?.recordsets?.[0]?.[0] ||
        null;

      // If Postgres executed a CALL to a procedure, the recordset won't contain the new role details.
      // We will fallback to querying tblmst_userroles to retrieve it.
      if (!newRoleData || (!newRoleData.user_role_id && !newRoleData.User_role_id && !newRoleData.userRoleId)) {
        try {
          const pool = await connectToDatabase();
          const queryResult = await pool.query(
            'SELECT user_role_id, user_role, "Description" FROM public.tblmst_userroles WHERE LOWER(user_role) = LOWER($1) AND "Status" = 1 LIMIT 1;',
            [formattedRole]
          );
          if (queryResult?.rows?.[0]) {
            newRoleData = queryResult.rows[0];
          }
        } catch (dbErr) {
          console.error("Error fetching newly created role details:", dbErr);
          logError("roleManagement/add/route.js:fetchNewRoleDetails", dbErr);
        }
      }

      if (newRoleData) {
        const roleId =
          newRoleData.user_role_id ||
          newRoleData.User_role_id ||
          newRoleData.userRoleId ||
          newRoleData.RoleId ||
          newRoleData.id ||
          newRoleData.Id;
        if (roleId) {
          newRoleData.user_role_id = roleId;
        }
      }

      await logAudit({
        userId,
        userName,
        actionType: "ROLE_CREATED",
        description: `${userName} created a new role '${formattedRole}'`,
      });

      await logSuccess("POST /api/roleManagement/add", {
        message: "Role created successfully",
        userId,
        role: formattedRole,
      });

      return NextResponse.json(
        {
          success: true,
          message,
          newRole: newRoleData,
        },
        { status: 200 }
      );
    }

    await logWarning("POST /api/roleManagement/add", {
      message,
      userId,
      role: formattedRole,
      statusCode,
    });

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status: statusCode }
    );
  } catch (error) {
    console.error("Create Role Error:", error);
    logError("POST /api/roleManagement/add", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error?.message || "Internal server error.",
      },
      { status: 500 }
    );
  }
}

async function CreateRole(newRole, Description, userId) {
  try {
    const inputParams = {
      p_newrole: newRole,
      p_description: Description,
      p_userid: userId,
    };

    return await executeStoredProcedure(
      "usp_InsertUserRole",
      inputParams,
      outputmsgWithStatusCodeParams
    );
  } catch (error) {
    console.error("Error executing usp_InsertUserRole:", error);
    logError("roleManagement/add/route.js:CreateRole", error);
    throw error;
  }
}
