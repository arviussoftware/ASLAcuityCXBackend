// app/api/userRoles/addBulkRoles/route.js
import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const body = await request.json();
    const { roleIds, userIds, currentUserId } = body;

    // Step 1: Auth token check
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Step 2: Privilege check (assign roles)
    const hasAssignPermission = await checkUserPrivilege(
      currentUserId,
      MODULES.USER_MANAGEMENT,
      PRIVILEGES.CREATE
    );

    if (!hasAssignPermission) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: You do not have permission to assign roles.",
        },
        { status: 403 }
      );
    }

    // Step 3: Input validation
    const missingFields = [
      { name: "roleIds", value: roleIds },
      { name: "userIds", value: userIds },
      { name: "currentUserId", value: currentUserId },
    ].filter((f) => isInvalid(f.value));

    if (missingFields.length > 0) {
      const fieldNames = missingFields.map((f) => f.name).join(", ");
      return NextResponse.json(
        { success: false, message: `Missing or invalid fields: ${fieldNames}` },
        { status: 400 }
      );
    }

    // Step 4: Convert userIds array to a comma-separated string if needed
    const roleIdsStr = Array.isArray(roleIds) ? roleIds.join(",") : roleIds;
    const userIdsStr = Array.isArray(userIds) ? userIds.join(",") : userIds;

    // Step 5: Execute stored procedure
    const spResult = await assignBulkRoles({
      roleIds: roleIdsStr,
      userIds: userIdsStr,
      createdBy: currentUserId,
    });

    const statusCode = parseInt(spResult.output?.statuscode || 500);
    const message = spResult.output?.outputmsg || "Unknown error occurred.";

    return NextResponse.json(
      {
        success: statusCode === 200,
        message,
      },
      { status: statusCode }
    );
  } catch (error) {
    console.error("Role assignment failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Internal Server Error: " + error.message,
      },
      { status: 500 }
    );
  }
}

async function assignBulkRoles({ roleIds, userIds, createdBy }) {
  const inputParams = {
    RoleIds: roleIds,
    UserIds: userIds, // A comma-separated string of user IDs
    CreatedBy: createdBy,
  };

  return await executeStoredProcedure(
    "usp_InsertBulkRoles", // Make sure the stored procedure name is correct
    inputParams,
    outputmsgWithStatusCodeParams
  );
}
