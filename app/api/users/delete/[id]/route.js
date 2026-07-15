// app/api/users/delete/[id]/route.js
import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { isInvalid } from "@/lib/generic";

import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request, { params }) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const authHeader = request.headers.get("authorization");
    const orgIds =
      request.headers.get("orgIds") || request.headers.get("orgId");
    const userIdToDelete = parseInt(resolvedParams?.id);
    const { currentUserId } = await request.json();

    // 🔐 Step 2: Check if token is missing or incorrect
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      await logWarning(
        "POST /api/users/delete/[id]",
        "Missing or invalid Authorization header",
      );
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      await logWarning("POST /api/users/delete/[id]", "Invalid API token");
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const hasAddPermission = await checkUserPrivilege(
      currentUserId,
      MODULES.USER_MANAGEMENT,
      PRIVILEGES.DELETE,
      orgIds,
    );

    if (!hasAddPermission) {
      await logWarning(
        "POST /api/users/delete/[id]",
        "User lacks permission to delete user.",
        { currentUserId, userIdToDelete },
      );
      return NextResponse.json(
        {
          success: false,
          message:
            "Unauthorized: You do not have permission to delete the user.",
        },
        { status: 403 },
      );
    }

    // Ensure userIdToDelete and currentUserId are valid integers
    if (isInvalid(userIdToDelete) || isInvalid(currentUserId)) {
      await logWarning(
        "POST /api/users/delete/[id]",
        "Invalid userIdToDelete or currentUserId.",
        { userIdToDelete, currentUserId },
      );
      return NextResponse.json(
        { message: "Request body or parameter could not be read properly." },
        { status: 400 },
      );
    }

    // Delete user record from database
    const result = await deleteUserById(userIdToDelete, currentUserId);

    // Check if the result has the expected output
    if (!result || !result.output) {
      await logError(
        "POST /api/users/delete/[id]",
        new Error("SP returned no output"),
        { userIdToDelete },
      );
      return NextResponse.json(
        { message: "Error occurred while processing the request." },
        { status: 500 },
      );
    }

    await logSuccess("POST /api/users/delete/[id]", "User deleted successfully.", {
      userIdToDelete,
      currentUserId,
    });

    return NextResponse.json(
      { message: result.output.outputmsg },
      // { status: result.output.statuscode }
    );
  } catch (error) {
    await logError("POST /api/users/delete/[id]", error); // ← ADD THIS LINE
    // Handle specific error types
    if (error instanceof RangeError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    // General error handling
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

async function deleteUserById(id, loggedInUserId) {
  const inputParams = {
    userIdToDelete: id,
    deletedBy: loggedInUserId,
  };

  // Execute stored procedure and return the result
  const result = await executeStoredProcedure(
    "usp_DeleteUser",
    inputParams,
    outputmsgWithStatusCodeParams,
  );

  // Ensure that the result has valid output
  if (!result || !result.output) {
    throw new Error("Failed to delete user. No output received.");
  }

  return result;
}
