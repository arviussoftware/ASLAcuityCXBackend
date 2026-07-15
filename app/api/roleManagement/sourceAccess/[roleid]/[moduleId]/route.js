import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
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
      await logWarning("GET /api/roleManagement/sourceAccess/[roleid]/[moduleId]", {
        message: "Role ID, Module ID, and Org ID are required",
      });
      return NextResponse.json(
        { success: false, message: "Role ID, Module ID, and Org ID are required" },
        { status: 400 }
      );
    }

    const isSuperAdmin = await isSuperAdminFromRequest();
    if (!isSuperAdmin && isSuperAdminRoleId(roleId)) {
      await logWarning("GET /api/roleManagement/sourceAccess/[roleid]/[moduleId]", {
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

    // ✅ p_ prefix — PostgreSQL function signature match
    const [sourcesResult, savedResult] = await Promise.all([
      executeStoredProcedure("usp_GetSources"),
      executeStoredProcedure("usp_GetSavedSourceAccessForRoleModule", {
        p_roleId:   roleId,
        p_moduleId: moduleId,
        p_orgId:    orgId,
      }),
    ]);

    // ✅ recordset pehle check karo
    const rawSources = sourcesResult?.recordset || sourcesResult?.recordsets?.[0] || [];
    const sources = rawSources.map((row) => ({
      ...row,
      id:          row.id ?? row.Id ?? row.SourceId ?? row.SourceID ?? row.sourceId,
      source:      row.source ?? row.Source ?? row.SourceName ?? row.Name ?? row.Source_Type,
      description: row.description ?? row.Description ?? row.SourceDescription ?? row.Details,
    }));

    const savedSourceIds = (savedResult?.recordset || [])
      .map((row) => Number(row.SourceId ?? row.sourceId ?? row.id))
      .filter((id) => Number.isFinite(id));

    await logSuccess("GET /api/roleManagement/sourceAccess/[roleid]/[moduleId]", {
      message: "Source access fetched successfully",
      roleId,
      moduleId,
      orgId,
      sourceCount: sources.length,
      savedSourceCount: savedSourceIds.length,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Source access fetched successfully",
        sources,
        savedSourceIds,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" },
      }
    );
  } catch (error) {
    console.error("Error while fetching source access:", error);
    logError("GET /api/roleManagement/sourceAccess/[roleid]/[moduleId]", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
