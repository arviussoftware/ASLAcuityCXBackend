import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import PrivilegeModel from "@/lib/models/privilegeview";
import { isSuperAdminFromRequest, isSuperAdminRoleId } from "@/lib/auth/superAdmin";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { pathname } = new URL(request.url);
    const parts    = pathname.split("/");
    const roleId   = Number(parts[parts.length - 2]);
    const moduleId = Number(parts[parts.length - 1]);
    const orgIdRaw = request.headers.get("orgId") || request.headers.get("orgid");
    const orgId    = orgIdRaw ? Number(orgIdRaw) : NaN;

    if (!Number.isFinite(roleId) || !Number.isFinite(moduleId) || !Number.isFinite(orgId)) {
      await logWarning("GET /api/roleManagement/savedPrivileges/[roleid]/[moduleId]", {
        message: "Role ID, Module ID, and Org ID are required",
      });
      return NextResponse.json(
        { success: false, message: "Role ID, Module ID, and Org ID are required" },
        { status: 400 }
      );
    }

    const isSuperAdmin = await isSuperAdminFromRequest();
    if (!isSuperAdmin && isSuperAdminRoleId(roleId)) {
      await logWarning("GET /api/roleManagement/savedPrivileges/[roleid]/[moduleId]", {
        message: "You are not allowed to access Super Admin privileges.",
        roleId,
        moduleId,
        orgId,
      });
      return NextResponse.json(
        { success: false, message: "You are not allowed to access Super Admin privileges." },
        { status: 403 }
      );
    }

    // ✅ Parallel calls — p_ prefix PostgreSQL function signature match
    const [privilegesResult, savedPrivilegesResult] = await Promise.all([
      executeStoredProcedure("usp_ModulePrevilege", { p_moduleId: moduleId }),
      executeStoredProcedure("usp_GetSavedPrivilegesForRoleAndModule", {
        p_roleId:   roleId,
        p_moduleId: moduleId,
        p_orgId:    orgId,
      }),
    ]);

    const rawPrivileges = privilegesResult?.recordset || privilegesResult?.recordsets?.[0] || [];
    const privileges    = setPrivilegesModel(rawPrivileges);
    const savedPrivileges = savedPrivilegesResult?.recordset || [];

    // Interaction module — annotation sub-privileges inject karo
    const INTERACTION_MODULE_ID = 6;
    const ANNOTATION_SUB_DEFS = [
      { PrivilegeId: 32, PrivilegeName: "Create Annotation" },
      { PrivilegeId: 33, PrivilegeName: "View Annotation"   },
      { PrivilegeId: 34, PrivilegeName: "Edit Annotation"   },
      { PrivilegeId: 35, PrivilegeName: "Delete Annotation" },
    ];
    const ANNOTATION_SUB_IDS = [32, 33, 34, 35];
    const ANNOTATION_ORDER   = [33, 32, 34, 35];

    let finalPrivileges = privileges;
    if (Number(moduleId) === INTERACTION_MODULE_ID) {
      const existingIds = new Set(privileges.map((p) => p.PrivilegeId));
      const missing     = ANNOTATION_SUB_DEFS.filter((d) => !existingIds.has(d.PrivilegeId));

      if (missing.length > 0) {
        const injected = missing.map(
          (d) => new PrivilegeModel(d.PrivilegeId, "Interaction", d.PrivilegeId, d.PrivilegeName, INTERACTION_MODULE_ID)
        );
        finalPrivileges = [...privileges, ...injected];
      }

      finalPrivileges = [
        ...finalPrivileges.filter((p) => !ANNOTATION_SUB_IDS.includes(p.PrivilegeId)),
        ...ANNOTATION_ORDER.map((id) => finalPrivileges.find((p) => p.PrivilegeId === id)).filter(Boolean),
      ];
    }

    await logSuccess("GET /api/roleManagement/savedPrivileges/[roleid]/[moduleId]", {
      message: "Combined privileges data fetched successfully",
      roleId,
      moduleId,
      orgId,
      privilegeCount: finalPrivileges.length,
      savedPrivilegeCount: savedPrivileges.length,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Combined privileges data fetched successfully",
        privileges: finalPrivileges,
        savedPrivileges,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" },
      }
    );
  } catch (error) {
    console.error("Error occurred while processing GET request:", error);
    logError("GET /api/roleManagement/savedPrivileges/[roleid]/[moduleId]", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

function setPrivilegesModel(recordset) {
  return (recordset || []).map(
    (privilege) =>
      new PrivilegeModel(
        privilege.ID            ?? privilege.id,
        privilege.ModuleName    ?? privilege.moduleName ?? privilege.modulename,
        privilege.PrivilegeId   ?? privilege.privilegeId ?? privilege.privilegeid,
        privilege.PrivilegeName ?? privilege.privilegeName ?? privilege.privilegename,
        privilege.ModuleId      ?? privilege.moduleId ?? privilege.moduleid,
      )
  );
}
