import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import { executeStoredProcedure } from "@/lib/sql";
import { setPrivilege } from "@/lib/models/moduleswithprivileges";

export const dynamic = "force-dynamic";

import { jwtVerify } from "jose";
import { getSuperAdminRoleId, isSuperAdminRoleId } from "@/lib/auth/superAdmin";

export async function GET(request) {
  try {
    const token = request.cookies.get("sessionToken")?.value;

    let isSuperAdmin   = false;
    let verifiedUserId = null;
    let payload        = null;

    if (token) {
      try {
        const secretKey = new TextEncoder().encode(process.env.API_SECRET_KEY);
        const verified  = await jwtVerify(token, secretKey);

        verifiedUserId = verified?.payload?.userId ?? null;

        payload = verified?.payload || {};
        const roles   = payload.userRole || payload.userRoles || payload.roles || [];

        isSuperAdmin = Array.isArray(roles)
          ? roles.some((r) => isSuperAdminRoleId(r?.roleId))
          : false;
      } catch {
        isSuperAdmin = false;
      }
    }

    const loggedInUserId = request.headers.get("loggedInUserId") || verifiedUserId;
    const moduleId       = request.headers.get("moduleId");
    const orgIds         = request.headers.get("orgIds") || request.headers.get("orgId");


    if (
      isInvalid(loggedInUserId) ||
      isInvalid(moduleId) ||
      (!isSuperAdmin && isInvalid(orgIds))
    ) {
      return NextResponse.json(
        { message: "Headers are missing. Required: loggedInUserId, moduleId, orgIds" },
        { status: 400 },
      );
    }

    // ==========================
    // SUPER ADMIN
    // ==========================
    if (isSuperAdmin) {
      const privileges = await getAllModulePrivileges(moduleId);

      // Enforce license override: if module not licensed, force NO_ACCESS for returned privileges
      const licensed = Array.isArray(payload?.licensedModules) ? payload.licensedModules.map(Number) : null;
      const NONE_PRIVILEGE_ID = 11;
      if (Array.isArray(licensed) && !licensed.includes(Number(moduleId))) {
        for (let i = 0; i < privileges.length; i++) {
          privileges[i].PrivilegeId = NONE_PRIVILEGE_ID;
          privileges[i].privilegeId = NONE_PRIVILEGE_ID;
        }
      }

      return NextResponse.json(
        { message: "Super Admin access", PrivilegeList: privileges, privileges },
        { status: 200 },
      );
    }

    // ==========================
    // NORMAL USER
    // ==========================
    const result = await getPrivileges(loggedInUserId, moduleId, orgIds);
    const rows = result?.recordset || result?.recordsets?.[0] || [];

    const PrivilegeList = setPrivilege(rows);

    // Enforce license override: if module not licensed, force NO_ACCESS for returned privileges
    const licensed = Array.isArray(payload?.licensedModules) ? payload.licensedModules.map(Number) : null;
    const NONE_PRIVILEGE_ID = 11;
    if (Array.isArray(licensed) && !licensed.includes(Number(moduleId))) {
      for (let i = 0; i < PrivilegeList.length; i++) {
        PrivilegeList[i].PrivilegeId = NONE_PRIVILEGE_ID;
        PrivilegeList[i].privilegeId = NONE_PRIVILEGE_ID;
      }
    }

    return NextResponse.json(
      {
        message:       "Privileges fetched successfully",
        PrivilegeList,
        privileges:    PrivilegeList,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("moduleswithPrivileges error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}

async function getPrivileges(loggedInUserId, moduleId, orgIds) {
  return await executeStoredProcedure(
    "sp_getRoleModulesWithPrivileges",
    {
      p_userrole: Number(loggedInUserId),
      p_moduleid: Number(moduleId),
      p_orgids:   orgIds?.toString() || null,
    },
  );
}

async function getAllModulePrivileges(moduleId) {
  const superRoleId = getSuperAdminRoleId();

  const result = await executeStoredProcedure(
    "usp_ModulePrevilege",
    { p_moduleId: Number(moduleId) },
  );

  // ✅ recordset pehle check karo
  const rows = result?.recordset || result?.recordsets?.[0] || [];

  return rows.map((row) => ({
    // ✅ Capital aur camelCase dono
    RoleId:      superRoleId,
    ModuleId:    row.ModuleId    ?? row.moduleid,
    PrivilegeId: row.PrivilegeId ?? row.privilegeid,
    UserRole:    "Super Admin",
    roleId:      superRoleId,
    moduleId:    row.ModuleId    ?? row.moduleid,
    privilegeId: row.PrivilegeId ?? row.privilegeid,
    userRole:    "Super Admin",
  }));
}