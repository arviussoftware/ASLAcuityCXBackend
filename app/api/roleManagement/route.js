import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql";
import { setUsersRolesModel } from "@/lib/models/userroles";
import { isInvalid } from "@/lib/generic";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import {
  isSuperAdminFromRequest,
  isSuperAdminRoleId,
} from "@/lib/auth/superAdmin";
import { jwtVerify } from "jose";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      await logWarning("GET /api/roleManagement", {
        message: "Unauthorized: Token missing",
      });
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: Token missing",
        },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      await logWarning("GET /api/roleManagement", {
        message: "Unauthorized: Invalid token",
      });
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: Invalid token",
        },
        { status: 401 }
      );
    }

    if (isInvalid(loggedInUserId)) {
      await logWarning("GET /api/roleManagement", {
        message: "Logged-in user ID is missing or invalid.",
      });
      return NextResponse.json(
        {
          success: false,
          message: "Logged-in user ID is missing or invalid.",
        },
        { status: 400 }
      );
    }

    const isSuperAdmin = await isSuperAdminFromRequest();
    const hasViewPermission = isSuperAdmin || await checkUserPrivilege(
      loggedInUserId,
      MODULES.ROLE_MANAGEMENT,
      PRIVILEGES.VIEW
    );

    if (!hasViewPermission) {
      await logWarning("GET /api/roleManagement", {
        message: "Unauthorized: No permission to view roles.",
        loggedInUserId,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: No permission to view roles.",
        },
        { status: 403 }
      );
    }

    const primaryUserId = await getPrimaryUserIdFromRequest(request);
    const roles = await getRoles(primaryUserId, isSuperAdmin);

    let rolesData = await setUsersRolesModel(
      roles.recordset || roles.recordsets?.[0] || []
    );

    rolesData = rolesData.map((role) => ({
      ...role,
      user_role_id: role.roleId,
      user_role: role.roleName,
      Description: role.description,
    }));

    if (!isSuperAdmin) {
      rolesData = rolesData.filter((r) => !isSuperAdminRoleId(r.roleId));
    }

    await logSuccess("GET /api/roleManagement", {
      message: "Roles fetched successfully",
      roleCount: rolesData.length,
      loggedInUserId,
    });

    const response = new Response(
      JSON.stringify({
        success: true,
        message: "Roles fetched successfully",
        roles: rolesData,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );

    return response;
  } catch (error) {
    console.error("Error occurred while processing GET request:", error);
    logError("GET /api/roleManagement", error);
    return new Response(
      JSON.stringify({ success: false, message: "Internal server error" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
}

async function getRoles(roleId, includeSuperAdmin) {
  try {
    const result = await executeStoredProcedure(
      "usp_getuserroles",
      {
        p_roleid: null || null,
        p_includesuperadmin: !!includeSuperAdmin,
      }
    );

    await logSuccess("roleManagement/route.js:getRoles", {
      message: "Roles stored procedure executed successfully",
      includeSuperAdmin,
    });

    return result;
  } catch (error) {
    console.error("Error executing PostgreSQL function:", error);
    logError("roleManagement/route.js:getRoles", error);
    throw error;
  }
}

async function getPrimaryUserIdFromRequest(request) {
  try {
    const token = request.cookies.get("sessionToken")?.value;

    if (!token) return null;

    const secretKey = new TextEncoder().encode(
      process.env.API_SECRET_KEY
    );

    const verified = await jwtVerify(token, secretKey);

    const payload = verified?.payload || {};

    const roles =
      payload.userRole ||
      payload.userRoles ||
      payload.roles ||
      [];

    if (!Array.isArray(roles) || !roles.length) {
      return null;
    }

    return Number(payload.userId ?? null) || null;
  } catch (error) {
    console.error("Error reading user from token:", error);
    logError("roleManagement/route.js:getPrimaryUserIdFromRequest", error);
    await logWarning("roleManagement/route.js:getPrimaryUserIdFromRequest", {
      message: "Failed to read user from token.",
    });
    return null;
  }
}
