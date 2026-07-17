import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { setUsersRolesModel } from "@/lib/models/userroles";
import { isSuperAdminFromRequest } from "@/lib/auth/superAdmin";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const includeSuperAdmin = await isSuperAdminFromRequest(); // boolean, true/false
    const roleDetails = await getUserRoles(includeSuperAdmin);
    if (roleDetails.recordset.length > 0) {
      const roles = await setUsersRolesModel(roleDetails.recordset);
      return NextResponse.json({ message: "Success", roles }, { status: 200 });
    } else {
      return NextResponse.json(
        { message: "User roles not found." },
        { status: 404 },
      );
    }
  } catch (error) {
    await logError("GET /api/userRoles", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

async function getUserRoles(includeSuperAdmin) {
  const result = await executeStoredProcedure("usp_getuserroles", {
    roleId: null,
    includeSuperAdmin,
  });
  return result;
}
