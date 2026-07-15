// app/api/integrationWorkspace/route.js
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import { executeStoredProcedure } from "@/lib/sql.js";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { isSuperAdminFromRequest } from "@/lib/auth/superAdmin";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing." },
        { status: 401 },
      );
    }

    const token = authHeader.slice(7);
    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token." },
        { status: 401 },
      );
    }

    const loggedInUserId = request.headers.get("loggedInUserId") ?? "";
    const orgIds = request.headers.get("orgIds") || request.headers.get("orgId") || "";
    const orgIdRaw = request.headers.get("orgId") ?? "";

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { success: false, message: "loggedInUserId header is missing or invalid." },
        { status: 400 },
      );
    }

    const isSuperAdmin = await isSuperAdminFromRequest();
    const orgId = isInvalid(orgIdRaw) ? null : Number(orgIdRaw);

    if (!isSuperAdmin && orgId === null) {
      return NextResponse.json(
        { success: false, message: "orgId header is missing or invalid." },
        { status: 400 },
      );
    }

    const hasViewPrivilege = await checkUserPrivilege(
      loggedInUserId,
      MODULES.INTEGRATION,
      PRIVILEGES.VIEW,
      orgIds || orgId,
    );

    if (!hasViewPrivilege) {
      return NextResponse.json(
        {
          success: false,
          message: "Forbidden: You do not have access to the Integration module.",
        },
        { status: 403 },
      );
    }

    const result = isSuperAdmin
      ? await executeStoredProcedure("usp_GetSources")
      : await executeStoredProcedure("usp_GetSourcesByUserIdAndOrg", {
          UserId: Number(loggedInUserId),
          OrgId: orgId,
        });

    const rawSources = result.recordsets?.[0] ?? [];
    const sources = rawSources.map((row) => ({
      ...row,
      id: row.id ?? row.Id ?? row.SourceId ?? row.SourceID ?? row.sourceId,
      source: row.source ?? row.Source ?? row.SourceName ?? row.Name ?? row.Source_Type,
      description:
        row.description ??
        row.Description ??
        row.SourceDescription ??
        row.Details,
    }));

    return NextResponse.json({
      success: true,
      message: "Sources fetched successfully.",
      data: sources,
    });
  } catch (error) {
    console.error("[integrationWorkspace GET] Unexpected error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error." },
      { status: 500 },
    );
  }
}

