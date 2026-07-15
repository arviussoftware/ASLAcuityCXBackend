// app/api/userRoles/byOrg/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { setUsersRolesModel } from "@/lib/models/userroles";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const currentUserId = parseInt(request.headers.get("loggedInUserId"), 10);

    if (!currentUserId || isNaN(currentUserId)) {
      return NextResponse.json(
        { message: "loggedInUserId header is missing or invalid." },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure(
      "usp_GetUserRolesByOrgHierarchy",
      { currentUserId },
    );

    if (result.recordset?.length > 0) {
      const roles = await setUsersRolesModel(result.recordset);
      return NextResponse.json({ message: "Success", roles }, { status: 200 });
    }

    return NextResponse.json(
      { message: "No roles found.", roles: [] },
      { status: 200 },
    );
  } catch (error) {
    console.error("GET /api/userRoles/byOrg error:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
