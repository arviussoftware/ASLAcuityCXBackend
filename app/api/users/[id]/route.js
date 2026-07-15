import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request, { params }) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const authHeader = request.headers.get("authorization");
    const userUniqueId = resolvedParams?.id;
    const currentUserId = request.headers.get("loggedInUserId");

    // 🔐 Step 1: Check token
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      await logWarning(
        "GET /api/users/[id]",
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
      await logWarning("GET /api/users/[id]", "Invalid API token");
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

    if (isInvalid(userUniqueId) || isInvalid(currentUserId)) {
      await logWarning(
        "GET /api/users/[id]",
        "Invalid userUniqueId or currentUserId.",
        { userUniqueId, currentUserId },
      );
      return NextResponse.json(
        {
          message: "Request headers or parameter could not be read properly.",
        },
        { status: 400 },
      );
    }

    // Fetch user record from database
    const userDetails = await getUserDetailsById(userUniqueId, currentUserId);

    if (!userDetails.recordset.length) {
      await logWarning("GET /api/users/[id]", "User not found.", {
        userUniqueId,
      });
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    const userRecord = userDetails.recordset[0];

    // Map the results into the desired format
    const user = {
      userId: userRecord.userId,
      // ✅ userLoginId mapped from loginId (user_login_id) — this is what the Update form binds to
      userLoginId: userRecord.loginId,
      // ✅ kept for any other consumers that still read userFullName
      userFullName: userRecord.userFullName,
      email: userRecord.email,
      firstName: userRecord.firstName,
      middleName: userRecord.middleName,
      lastName: userRecord.lastName,
      phone: userRecord.phone,
      userAddress: userRecord.userAddress,
      activeStatus: userRecord.activeStatus,
      isActive: userRecord.isActive,
      userUniqueId: userRecord.userUniqueId,
      roles: userRecord.roleId
        ? userRecord.roleId.split(",").map((roleId, index) => ({
            roleId: parseInt(roleId, 10),
            roleName: userRecord.roleName.split(",")[index],
          }))
        : [],
      organizations: userRecord.orgIds
        ? userRecord.orgIds.split(",").map((orgId, index) => ({
            orgId: parseInt(orgId, 10),
            orgName: userRecord.orgNames.split(",")[index],
          }))
        : [],
    };

    await logSuccess("GET /api/users/[id]", "User fetched successfully.", {
      userUniqueId,
      currentUserId,
    });

    return NextResponse.json(
      { message: "Record found", user },
      { status: 200 },
    );
  } catch (error) {
    await logError("GET /api/users/[id]", error); // ← ADD THIS
    if (error instanceof RangeError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

async function getUserDetailsById(userUniqueId, currentUserId) {
  const inputParams = {
    userUniqueId: userUniqueId,
    currentUserId: currentUserId,
  };

  const result = await executeStoredProcedure(
    "usp_GetUsersDetailsById",
    inputParams,
  );

  return result;
}
