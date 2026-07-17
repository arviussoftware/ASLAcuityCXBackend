import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import {
  isSuperAdminFromRequest,
  isSuperAdminRoleId,
} from "@/lib/auth/superAdmin";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function GET(request, context) {
  try {
    const params = await context.params;
    const roleId = Number(params.roleid);

    if (!Number.isFinite(roleId)) {
      await logWarning("GET /api/roleManagement/savedOrgs/[roleid]", {
        message: "Invalid role ID",
        roleId,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Invalid role ID",
        },
        { status: 400 }
      );
    }

    const isSuperAdmin = await isSuperAdminFromRequest();

    if (!isSuperAdmin && isSuperAdminRoleId(roleId)) {
      await logWarning("GET /api/roleManagement/savedOrgs/[roleid]", {
        message: "Not allowed",
        roleId,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Not allowed",
        },
        { status: 403 }
      );
    }

    const result = await executeStoredProcedure(
      "usp_getorgswithsavedprivilegesforrole",
      {
        p_roleid: roleId, // lowercase preferred for PG mapping
      }
    );

    const orgIds = (result?.recordset || [])
      .map((row) => String(row.OrgId ?? row.orgid))
      .filter(Boolean);

    await logSuccess("GET /api/roleManagement/savedOrgs/[roleid]", {
      message: "Saved orgs fetched successfully",
      roleId,
      orgCount: orgIds.length,
    });

    return NextResponse.json(
      {
        success: true,
        orgIds,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    await logError("GET /api/roleManagement/savedOrgs/[roleid]", error);

    return NextResponse.json(
      {
        success: false,
        message: "Internal server error.",
      },
      { status: 500 }
    );
  }
}
