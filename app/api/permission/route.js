import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { setPermissionModel } from "@/lib/models/permission";
import { isInvalid } from "@/lib/generic";
import { jwtVerify } from "jose";
import { getSuperAdminRoleId, isSuperAdminRoleId } from "@/lib/auth/superAdmin";

// Ensure the route is dynamic
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    // Extract userId from the request query

    const token = request.cookies.get("sessionToken")?.value;

    if (!token) {
      return NextResponse.json(
        { message: "Unauthorized, no token found." },
        { status: 401 },
      );
    }

    let payload;
    try {
      const secretKey = new TextEncoder().encode(process.env.API_SECRET_KEY);
      const verified = await jwtVerify(token, secretKey);
      payload = verified.payload;
    } catch (err) {
      return NextResponse.json(
        { message: "Unauthorized, invalid token." },
        { status: 401 },
      );
    }
    // Headers (if necessary for authentication, etc.)
    const userId = payload.userId;
    const roles =
      payload?.userRole || payload?.userRoles || payload?.roles || [];
    const isSuperAdmin = Array.isArray(roles)
      ? roles.some((r) => isSuperAdminRoleId(r?.roleId))
      : false;

    // Validate the userId query parameter
    if (isInvalid(userId)) {
      return NextResponse.json(
        { message: "UserId is required in the query parameters." },
        { status: 400 },
      );
    }

    const orgIds =
      request.headers.get("orgIds") || request.headers.get("orgId");
    if (!isSuperAdmin && isInvalid(orgIds)) {
      return NextResponse.json(
        {
          message:
            "Headers are missing, undefined, or empty. Required: orgIds.",
        },
        { status: 400 },
      );
    }

    if (isSuperAdmin) {
      const permissionModel = await getSuperAdminPermissionModel();

      // Enforce license override for Super Admin: if a module is not licensed, override its privileges to NONE (11)
      const licensed = Array.isArray(payload?.licensedModules) ? payload.licensedModules.map(Number) : null;
      const NONE_PRIVILEGE_ID = 11;
      if (Array.isArray(licensed)) {
        for (let i = 0; i < permissionModel.length; i++) {
          const mId = Number(permissionModel[i].ModuleId ?? permissionModel[i].moduleId);
          if (!licensed.includes(mId)) {
            permissionModel[i].PrivilegeId = NONE_PRIVILEGE_ID;
            permissionModel[i].privilegeId = NONE_PRIVILEGE_ID;
          }
        }
      }

      const response = NextResponse.json(
        { message: "Super Admin access", permissionModel },
        { status: 200 },
      );
      response.headers.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      );
      return response;
    }

    // Fetch permission model details for the specific userId
    const permissionModelDetails = await getPermissionModelDetails(
      userId,
      orgIds,
    );

    // Check if records were returned
    if (permissionModelDetails.recordsets.length > 0) {
      // Map the recordset to the PermissionModel class
      const permissionModel = await setPermissionModel(
        permissionModelDetails.recordsets[0],
      );

      // Enforce license override: if a module is not licensed, override its privileges to NONE (11)
      const licensed = Array.isArray(payload?.licensedModules) ? payload.licensedModules.map(Number) : null;
      const NONE_PRIVILEGE_ID = 11;
      if (Array.isArray(licensed)) {
        for (let i = 0; i < permissionModel.length; i++) {
          const mId = Number(permissionModel[i].ModuleId ?? permissionModel[i].moduleId);
          if (!licensed.includes(mId)) {
            permissionModel[i].PrivilegeId = NONE_PRIVILEGE_ID;
            permissionModel[i].privilegeId = NONE_PRIVILEGE_ID;
          }
        }
      }

      // Return a success response with the permission model data
      const response = NextResponse.json(
        {
          message: permissionModelDetails.output?.outputmsg || "Success",
          permissionModel,
        },
        {
          status: permissionModelDetails.output?.statuscode || 200,
        },
      );
      // Add Cache-Control headers
      response.headers.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      );

      return response;
    }
    // Return a "no result" response if no records were found
    return NextResponse.json(
      {
        message: permissionModelDetails.output?.outputmsg || "No result found",
      },
      {
        status: permissionModelDetails.output?.statuscode || 400,
      },
    );
  } catch (error) {
    return NextResponse.json(
      { message: "Internal server error || " + error.message },
      { status: 500 },
    );
  }
}

async function getPermissionModelDetails(userId, orgIds) {
  return await executeStoredProcedure(
    "usp_GetPrivilegesByUserid",
    {
      p_UserId: Number(userId),
      p_ModuleId: null,
      p_OrgIds: orgIds,
    },
    {}
  );
}

async function getSuperAdminPermissionModel() {
  const superRoleId = getSuperAdminRoleId();
  if (!superRoleId) {
    throw new Error(
      "SUPER_ADMIN_ROLE_ID is not configured (env SUPER_ADMIN_ROLE_ID).",
    );
  }
  const modulesResult = await executeStoredProcedure(
    "usp_GetNavbarModules",
    {},
    {},
  );
  const modules = modulesResult?.recordsets?.[0] || [];
  return modules.map((m) => ({
    id: 0,
    roleId: superRoleId,
    moduleId: m.ID,
    privilegeId: 1,
    RoleId: superRoleId,
    ModuleId: m.ID,
    PrivilegeId: 1,
  }));
}
