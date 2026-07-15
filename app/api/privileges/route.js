import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { setPrivilege } from "@/lib/models/moduleswithprivileges";
export const dynamic = "force-dynamic";
import { jwtVerify } from "jose";
import { getSuperAdminRoleId, isSuperAdminRoleId } from "@/lib/auth/superAdmin";
import { logError } from "@/lib/errorLogger";

export async function GET(request) {
  try {
    const token = request.cookies.get("sessionToken")?.value;
    if (!token) {
      return NextResponse.json(
        { message: "Unauthorized: No session" },
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
        { message: "Unauthorized: Invalid session" },
        { status: 401 },
      );
    }

    const loggedInUserId = payload.userId;
    if (!loggedInUserId) {
      return NextResponse.json(
        { message: "Unauthorized: No userId" },
        { status: 401 },
      );
    }

    const moduleId = request.headers.get("moduleId");
    // New PG procedure takes a single INT orgId, not a comma-separated string
    const orgIdRaw = request.headers.get("orgId") || request.headers.get("orgIds");
    const orgId = orgIdRaw ? parseInt(orgIdRaw, 10) : null;

    const roles = payload?.userRole || payload?.userRoles || payload?.roles || [];
    const isSuperAdmin = Array.isArray(roles)
      ? roles.some((r) => isSuperAdminRoleId(r?.roleId))
      : false;


    if (
      isInvalid(loggedInUserId) ||
      isInvalid(moduleId) ||
      (!isSuperAdmin && isInvalid(orgIdRaw))
    ) {
      return NextResponse.json(
        {
          message:
            "Headers are missing, undefined, or empty. Required: moduleId, orgId.",
        },
        { status: 400 },
      );
    }

    if (isSuperAdmin) {
      const superPrivileges = await getAllModulePrivileges(moduleId);
      const expandedSuper = expandAnnotationPrivileges(superPrivileges);

      // Enforce license override: if module not licensed, force NO_ACCESS for returned privileges
      const licensed = Array.isArray(payload?.licensedModules) ? payload.licensedModules.map(Number) : null;
      const NONE_PRIVILEGE_ID = 11;
      if (Array.isArray(licensed) && !licensed.includes(Number(moduleId))) {
        for (let i = 0; i < expandedSuper.length; i++) {
          expandedSuper[i].PrivilegeId = NONE_PRIVILEGE_ID;
          expandedSuper[i].privilegeId = NONE_PRIVILEGE_ID;
        }
      }

      const response = NextResponse.json(
        {
          message: "Super Admin access",
          privileges: expandedSuper,
          PrivilegeList: expandedSuper,
        },
        { status: 200 },
      );
      response.headers.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      );
      return response;
    }

    const result = await fetchPrivileges(loggedInUserId, moduleId, orgId);
    const { output, recordsets, recordset } = result;

    const privileges = await setPrivilege(selectPrivilegeRows(recordsets, recordset));

    // Enforce license override: if module not licensed, force NO_ACCESS for returned privileges
    const licensed = Array.isArray(payload?.licensedModules) ? payload.licensedModules.map(Number) : null;
    const NONE_PRIVILEGE_ID = 11;
    if (Array.isArray(licensed) && !licensed.includes(Number(moduleId))) {
      for (let i = 0; i < privileges.length; i++) {
        privileges[i].PrivilegeId = NONE_PRIVILEGE_ID;
        privileges[i].privilegeId = NONE_PRIVILEGE_ID;
      }
    }

    const expandedPrivileges = expandAnnotationPrivileges(privileges);

    const response = NextResponse.json(
      { message: output?.outputmsg || "Success", privileges: expandedPrivileges, PrivilegeList: expandedPrivileges },
      { status: output?.statuscode ?? 200 },
    );

    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );

    return response;
  } catch (error) {
    logError("api/privileges GET userId=" + (loggedInUserId ?? "?"), error);
    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 },
    );
  }
}

async function fetchPrivileges(userRoleId, moduleId, orgId) {
  const result = await executeStoredProcedure(
    "public.sp_getrolemoduleswithprivileges",
    {
      p_userrole: Number(userRoleId),
      p_moduleid: Number(moduleId),
      p_orgids:   orgId ? String(orgId) : null,
    },
    [],
  );
  return result;
}

async function getAllModulePrivileges(moduleId) {
  const superRoleId = getSuperAdminRoleId();
  if (!superRoleId) {
    throw new Error(
      "SUPER_ADMIN_ROLE_ID is not configured (env SUPER_ADMIN_ROLE_ID).",
    );
  }

  const result = await executeStoredProcedure(
    "public.usp_ModulePrevilege",     // added public. schema prefix
    { p_moduleid: Number(moduleId) },
    {},
  );

  const rows = result?.recordsets?.[0] ?? result?.recordset ?? [];
  return rows.map((row) => ({
    RoleId: superRoleId,
    ModuleId: row.ModuleId ?? row.moduleid ?? Number(moduleId),
    PrivilegeId: row.PrivilegeId ?? row.privilegeid,
    user_role: "Super Admin",
  }));
}

function selectPrivilegeRows(recordsets, recordset) {
  if (Array.isArray(recordsets)) {
    for (const rows of recordsets) {
      if (Array.isArray(rows) && rows.length > 0) {
        return rows;
      }
    }
  }

  if (Array.isArray(recordset) && recordset.length > 0) {
    return recordset;
  }

  return [];
}

function expandAnnotationPrivileges(privileges) {
  if (!Array.isArray(privileges)) return privileges;

  const annotationPriv = privileges.find(p => p.PrivilegeId === 28 || p.privilegeId === 28);
  if (!annotationPriv) return privileges;

  // We found ID 28. Let's create the granular versions 32, 33, 34, 35
  const granularIds = [32, 33, 34, 35];
  const newPrivileges = [];

  for (const id of granularIds) {
    newPrivileges.push({
      ...annotationPriv,
      PrivilegeId: id,
      privilegeId: id
    });
  }

  return [...privileges, ...newPrivileges];
}
