import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logAudit } from "@/lib/auditLogger";
import { isSuperAdminFromRequest, isSuperAdminRoleId } from "@/lib/auth/superAdmin";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const {
      privilegesToSave,
      sourceAccessToSave,
      uncheckedModuleIds,
      roleid,
      roleName,
      userId,
      userName,
      orgId,
    } = await request.json();

    const isSuperAdmin = await isSuperAdminFromRequest();
    if (!isSuperAdmin && isSuperAdminRoleId(roleid)) {
      await logWarning("POST /api/roleManagement/save", {
        message: "You are not allowed to modify Super Admin privileges.",
        roleid,
        userId,
      });
      return NextResponse.json(
        { success: false, message: "You are not allowed to modify Super Admin privileges." },
        { status: 403 },
      );
    }

    if (!privilegesToSave && !uncheckedModuleIds) {
      await logWarning("POST /api/roleManagement/save", {
        message: "No privileges selected for saving or modules to delete.",
        roleid,
        userId,
      });
      return NextResponse.json(
        { success: false, message: "No privileges selected for saving or modules to delete." },
        { status: 400 },
      );
    }

    const safeUncheckedModuleIds = Array.isArray(uncheckedModuleIds) ? uncheckedModuleIds : [];
    const safePrivilegesToSave = Array.isArray(privilegesToSave) ? privilegesToSave : [];

    const tvpData = safePrivilegesToSave
      .filter((privilege) => Number(privilege.privilegeId) !== 28)
      .map((privilege) => ({
        roleid: privilege.roleid,
        ModuleId: privilege.moduleId,
        PrivilegeId: privilege.privilegeId,
        OrgId: privilege.orgId || orgId || null,
      }));

    const result = await saveRoleModulePrivileges(
      tvpData,
      safeUncheckedModuleIds,
      roleid,
      orgId,
    );

    const privStatusCode = parseInt(
      result?.output?.statuscode ??
        result?.recordset?.[0]?.p_statuscode ??
        result?.recordset?.[0]?.statuscode,
    );
    const privOutputMsg =
      result?.output?.outputmsg ??
      result?.recordset?.[0]?.p_outputmsg ??
      result?.recordset?.[0]?.outputmsg;

    if (privStatusCode === 200) {
    const sourceData = (sourceAccessToSave || []).map((entry) => ({
        roleid: entry.roleid,
        ModuleId: entry.moduleId,
        SourceId: entry.sourceId,
        OrgId: entry.orgId || orgId || null,
      })).filter((entry) => Number.isFinite(Number(entry.ModuleId)) && Number.isFinite(Number(entry.SourceId)));

      const sourceSaveResult = await saveRoleModuleSourceAccess(
        sourceData,
        safeUncheckedModuleIds,
        roleid,
        orgId,
      );

      const srcStatusCode = parseInt(
        sourceSaveResult?.output?.statuscode ??
          sourceSaveResult?.recordset?.[0]?.p_statuscode ??
          sourceSaveResult?.recordset?.[0]?.statuscode,
      );
      const srcOutputMsg =
        sourceSaveResult?.output?.outputmsg ??
        sourceSaveResult?.recordset?.[0]?.p_outputmsg ??
        sourceSaveResult?.recordset?.[0]?.outputmsg;

      if (srcStatusCode !== 200) {
        await logWarning("POST /api/roleManagement/save", {
          message: srcOutputMsg || "Source access save failed.",
          roleid,
          userId,
          srcStatusCode,
        });
        return NextResponse.json(
          { success: false, message: srcOutputMsg || "Source access save failed." },
          { status: srcStatusCode || 400 },
        );
      }

      await logAudit({
        userId,
        userName,
        actionType: "ASSIGN_PRIVILEGES",
        description: `${userName} added privileges to role '${roleName}'`,
      });

      await logSuccess("POST /api/roleManagement/save", {
        message: "Privileges saved successfully.",
        roleid,
        userId,
        orgId,
      });

      return NextResponse.json(
        { success: true, message: privOutputMsg || "Privileges saved successfully." },
        { status: 200 },
      );
    }

    await logWarning("POST /api/roleManagement/save", {
      message: privOutputMsg || "Failed to save privileges.",
      roleid,
      userId,
      privStatusCode,
    });

    return NextResponse.json(
      { success: false, message: privOutputMsg || "Failed to save privileges." },
      { status: privStatusCode || 400 },
    );
  } catch (error) {
    console.error("Internal server error:", error);
    logError("POST /api/roleManagement/save", error);
    return NextResponse.json(
      { success: false, message: "Internal server error." },
      { status: 500 },
    );
  }
}

async function saveRoleModulePrivileges(tvpData, uncheckedModuleIds, roleid, orgId) {
  try {
    const result = await executeStoredProcedure(
      "usp_insertrolemoduleswithprivileges",
      {
        p_RoleModulePrivileges: JSON.stringify(Array.isArray(tvpData) ? tvpData : []),
        p_ModulesToDelete: JSON.stringify(Array.isArray(uncheckedModuleIds) ? uncheckedModuleIds : []),
        p_roleid: roleid,
        p_OrgId: orgId,
      },
      outputmsgWithStatusCodeParams,
    );
    return result;
  } catch (error) {
    console.error("saveRoleModulePrivileges exact error:", {
      message: error.message,
      stack: error.stack,
      detail: error.detail,
      hint: error.hint,
      code: error.code,
    });
    logError("roleManagement/save/route.js:saveRoleModulePrivileges", error);
    throw new Error(`Failed to save role-module-privilege mappings: ${error.message}`);
  }
}

async function saveRoleModuleSourceAccess(sourceData, uncheckedModuleIds, roleid, orgId) {
  try {
    const result = await executeStoredProcedure(
      "usp_InsertRoleModuleSourceAccess",
      {
        p_RoleModuleSourceAccess: JSON.stringify(Array.isArray(sourceData) ? sourceData : []),
        p_ModulesToDelete: JSON.stringify(Array.isArray(uncheckedModuleIds) ? uncheckedModuleIds : []),
        p_roleid: roleid,
        p_OrgId: orgId,
      },
      outputmsgWithStatusCodeParams,
    );
    return result;
  } catch (error) {
    console.error("saveRoleModuleSourceAccess exact error:", {
      message: error.message,
      stack: error.stack,
      detail: error.detail,
      hint: error.hint,
      code: error.code,
    });
    logError("roleManagement/save/route.js:saveRoleModuleSourceAccess", error);
    throw new Error(`Failed to save role-module-source mappings: ${error.message}`);
  }
}
