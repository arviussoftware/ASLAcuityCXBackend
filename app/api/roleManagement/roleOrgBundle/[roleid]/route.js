import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import PrivilegeModel from "@/lib/models/privilegeview";
import { jwtVerify } from "jose";
import {
  isSuperAdminFromRequest,
  isSuperAdminRoleId,
} from "@/lib/auth/superAdmin";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

const INTERACTION_MODULE_ID = 6;
const ANNOTATION_SUB_DEFS = [
  { PrivilegeId: 32, PrivilegeName: "Create Annotation" },
  { PrivilegeId: 33, PrivilegeName: "View Annotation" },
  { PrivilegeId: 34, PrivilegeName: "Edit Annotation" },
  { PrivilegeId: 35, PrivilegeName: "Delete Annotation" },
];
const ANNOTATION_SUB_IDS = [32, 33, 34, 35];
const ANNOTATION_ORDER = [33, 32, 34, 35];

export async function GET(request, { params }) {
  try {
    // ✅ Next.js 15 — params await karna zaroori hai
    const { roleid } = await params;
    const roleId     = Number(roleid);
    const orgIdRaw   = request.headers.get("orgId") || request.headers.get("orgid");
    const orgId      = orgIdRaw ? Number(orgIdRaw) : NaN;

    if (!Number.isFinite(roleId)) {
      await logWarning("GET /api/roleManagement/roleOrgBundle/[roleid]", {
        message: "Role ID is required",
        roleId,
      });
      return NextResponse.json(
        { success: false, message: "Role ID is required" },
        { status: 400 },
      );
    }

    if (!Number.isFinite(orgId)) {
      await logWarning("GET /api/roleManagement/roleOrgBundle/[roleid]", {
        message: "Org ID is required",
        roleId,
      });
      return NextResponse.json(
        { success: false, message: "Org ID is required" },
        { status: 400 },
      );
    }

    const isSuperAdmin = await isSuperAdminFromRequest();
    if (!isSuperAdmin && isSuperAdminRoleId(roleId)) {
      await logWarning("GET /api/roleManagement/roleOrgBundle/[roleid]", {
        message: "Not allowed",
        roleId,
      });
      return NextResponse.json(
        { success: false, message: "Not allowed" },
        { status: 403 },
      );
    }

    // Parallel calls — modules, saved privileges, all sources
    const [modulesResult, savedPrivilegesResult, sourcesResult] =
      await Promise.all([
        executeStoredProcedure("usp_GetModules_Data", { p_id: String(roleId) }),
        executeStoredProcedure("usp_GetSavedPrivilegesForRoleAndOrg", {
          p_roleId: roleId,
          p_orgId:  orgId,
        }),
        executeStoredProcedure("usp_GetSources"),
      ]);

    const token = request.cookies.get("sessionToken")?.value;
    let payload;
    if (token) {
      try {
        const secretKey = new TextEncoder().encode(process.env.API_SECRET_KEY);
        const verified = await jwtVerify(token, secretKey);
        payload = verified.payload;
      } catch (err) {
        console.warn("JWT verify failed in roleOrgBundle:", err?.message || err);
        await logWarning("GET /api/roleManagement/roleOrgBundle/[roleid]", {
          message: "JWT verify failed in roleOrgBundle",
          roleId,
          error: err?.message || String(err),
        });
      }
    }

    const licensed = Array.isArray(payload?.licensedModules) ? payload.licensedModules.map(Number) : null;

    let modules = (modulesResult?.recordset || []).map((m) => ({
      ID:         m.ID         ?? m.id,
      ModuleName: m.ModuleName ?? m.moduleName,
    }));

    if (Array.isArray(licensed)) {
      const allowed = new Set(licensed);
      modules = modules.filter((m) => allowed.has(Number(m.ID)));
    }

    // Group saved privileges by moduleId
    const savedRows = savedPrivilegesResult?.recordset || [];
    const savedByModuleId = savedRows.reduce((acc, row) => {
      const moduleId = String(row.ModuleId ?? row.moduleId);
      if (!acc[moduleId]) acc[moduleId] = [];
      acc[moduleId].push(Number(row.PrivilegeId ?? row.privilegeId));
      return acc;
    }, {});

    const rawSources = sourcesResult?.recordset || sourcesResult?.recordsets?.[0] || [];
    const sources = rawSources.map((row) => ({
      ...row,
      id:          row.id ?? row.Id ?? row.SourceId ?? row.SourceID ?? row.sourceId,
      source:      row.source ?? row.Source ?? row.SourceName ?? row.Name ?? row.Source_Type,
      description: row.description ?? row.Description ?? row.SourceDescription ?? row.Details,
    }));

    // Per module — privileges + source access
    // Per module — privileges + source access
const modulePayloads = await Promise.all(
  modules.map(async (module) => {
    const [privRes, savedSourceRes] = await Promise.all([
      //p_moduleId — PostgreSQL function signature match
      executeStoredProcedure("usp_ModulePrevilege", { p_moduleId: module.ID }),
      executeStoredProcedure("usp_GetSavedSourceAccessForRoleModule", {
        p_roleId:   roleId,
        p_moduleId: module.ID,
        p_orgId:    orgId,
      }).catch((err) => {
        console.error("usp_GetSavedSourceAccessForRoleModule error:", err);
        logError("roleManagement/roleOrgBundle/[roleid]/route.js:usp_GetSavedSourceAccessForRoleModule", err);
        return { recordset: [] };
      }),
    ]);

        const privileges = normalizeInteractionPrivileges(
          module.ID,
          setPrivilegesModel(privRes?.recordset || privRes?.recordsets?.[0] || []),
        );

        const savedPrivilegeIds = savedByModuleId[String(module.ID)] || [];
        const savedSourceIds = (savedSourceRes?.recordset || [])
          .map((row) => Number(row.SourceId ?? row.sourceId ?? row.id))
          .filter((id) => Number.isFinite(id));

        return {
          moduleId:        module.ID,
          moduleName:      module.ModuleName,
          privileges,
          savedPrivilegeIds,
          sources,
          savedSourceIds,
        };
      }),
    );

    await logSuccess("GET /api/roleManagement/roleOrgBundle/[roleid]", {
      message: "Role organization bundle fetched successfully",
      roleId,
      orgId,
      moduleCount: modules.length,
      payloadCount: modulePayloads.length,
    });

    return NextResponse.json(
      { success: true, modules, modulePayloads },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
      },
    );
  } catch (error) {
    console.error("roleOrgBundle error:", error);
    logError("GET /api/roleManagement/roleOrgBundle/[roleid]", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

function setPrivilegesModel(recordset) {
  return (recordset || []).map(
    (privilege) => ({
      ...privilege,
      id: privilege.ID ?? privilege.id,
      ID: privilege.ID ?? privilege.id,
      moduleName: privilege.ModuleName ?? privilege.moduleName ?? privilege.modulename,
      ModuleName: privilege.ModuleName ?? privilege.moduleName ?? privilege.modulename,
      privilegeId: privilege.PrivilegeId ?? privilege.privilegeId ?? privilege.privilegeid,
      PrivilegeId: privilege.PrivilegeId ?? privilege.privilegeId ?? privilege.privilegeid,
      privilegeName:
        privilege.PrivilegeName ??
        privilege.privilegeName ??
        privilege.privilegename ??
        privilege.privilege_name ??
        privilege.privilege_label ??
        privilege.label ??
        privilege.name ??
        privilege.Privilege ??
        privilege.privilege ??
        privilege.title ??
        "",
      PrivilegeName:
        privilege.PrivilegeName ??
        privilege.privilegeName ??
        privilege.privilegename ??
        privilege.privilege_name ??
        privilege.privilege_label ??
        privilege.label ??
        privilege.name ??
        privilege.Privilege ??
        privilege.privilege ??
        privilege.title ??
        "",
      moduleId: privilege.ModuleId ?? privilege.moduleId ?? privilege.moduleid,
      ModuleId: privilege.ModuleId ?? privilege.moduleId ?? privilege.moduleid,
    }),
  );
}

function normalizeInteractionPrivileges(moduleId, privileges) {
  if (Number(moduleId) !== INTERACTION_MODULE_ID) return privileges;

  const existingIds = new Set(privileges.map((p) => p.PrivilegeId));
  const injected = ANNOTATION_SUB_DEFS.filter(
    (d) => !existingIds.has(d.PrivilegeId),
  ).map(
    (d) =>
      ({
        ...d,
        id: d.PrivilegeId,
        ID: d.PrivilegeId,
        moduleName: "Interaction",
        ModuleName: "Interaction",
        privilegeId: d.PrivilegeId,
        PrivilegeId: d.PrivilegeId,
        privilegeName: d.PrivilegeName,
        PrivilegeName: d.PrivilegeName,
        moduleId: INTERACTION_MODULE_ID,
        ModuleId: INTERACTION_MODULE_ID,
      }),
  );

  const finalPrivileges = [...privileges, ...injected];
  return [
    ...finalPrivileges.filter((p) => !ANNOTATION_SUB_IDS.includes(p.PrivilegeId)),
    ...ANNOTATION_ORDER.map((id) =>
      finalPrivileges.find((p) => p.PrivilegeId === id),
    ).filter(Boolean),
  ];
}
