// app/api/userRoles/by-org/route.js

import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { orgIds } = body;

    if (!orgIds || !Array.isArray(orgIds) || orgIds.length === 0) {
      return NextResponse.json(
        { message: "Invalid or missing orgIds.", roles: [] },
        { status: 400 },
      );
    }

    // Convert [9, 79] → '[{"orgId":9},{"orgId":79}]' for the SP
    const orgIdsJson = JSON.stringify(orgIds.map((id) => ({ orgId: id })));

    // Single SP call — handles all orgs + their parents internally
    const result = await executeStoredProcedure("usp_GetRolesByOrg", {
      orgIds: orgIdsJson,
    });

    if (!result?.recordset) {
      return NextResponse.json(
        { message: "No roles found.", roles: [] },
        { status: 200 },
      );
    }

    const roles = result.recordset.map((row) => ({
      roleId: row.roleId,
      roleName: row.roleName,
      description: row.Description,
    }));

    return NextResponse.json({ message: "Success", roles }, { status: 200 });
  } catch (error) {
    await logError("POST /api/userRoles/by-org", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
