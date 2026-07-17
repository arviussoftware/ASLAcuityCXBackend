import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logAudit } from "@/lib/auditLogger";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { isInvalid, isValidPositiveInteger } from "@/lib/generic";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import {
  isSuperAdminFromRequest,
  isSuperAdminRoleId,
} from "@/lib/auth/superAdmin";
import {
  getAgentRoleIds,
  hasSelectedIds,
  resolveEffectiveRoles,
} from "@/lib/users/userCreation";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request, { params }) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const authHeader = request.headers.get("authorization");
    const userId = resolvedParams?.id;

    if (!isValidPositiveInteger(userId)) {
      await logWarning(
        "POST /api/users/update/[id]",
        "Malformed userId path parameter.",
        {
          userId,
        },
      );
      return NextResponse.json(
        { message: "Invalid user identifier." },
        { status: 400 },
      );
    }

    const numericUserId = Number(userId); // ← ADD THIS LINE

    // Get request body
    const {
      loginId,
      email,
      userFullName,
      firstName,
      middleName,
      lastName,
      rolesIds,
      phone,
      userAddress,
      isActive,
      orgIds,
      currentUserId,
      currentUserName,
    } = await request.json();

    if (
      //isInvalid(userId) ||
      isInvalid(currentUserId) ||
      isInvalid(loginId) ||
      isInvalid(userFullName) ||
      // isInvalid(email) ||
      // isInvalid(phone) ||
      // isInvalid(userAddress) ||
      isInvalid(isActive) ||
      !Array.isArray(orgIds) ||
      !hasSelectedIds(orgIds, "orgId")
    ) {
      await logWarning(
        "POST /api/users/update/[id]",
        "Invalid request body or missing parameters.",
        { userId, currentUserId },
      );
      return NextResponse.json(
        { message: "Invalid request body or missing parameters." },
        { status: 400 },
      );
    }

    if (!isValidPositiveInteger(currentUserId)) {
      return NextResponse.json(
        { message: "Invalid currentUserId identifier." },
        { status: 400 },
      );
    }

    const hasInvalidOrg = orgIds.some(item => !item || !isValidPositiveInteger(item.orgId));
    if (hasInvalidOrg) {
      return NextResponse.json(
        { message: "Invalid organization identifier inside list." },
        { status: 400 },
      );
    }

    // 🔐 Check token
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      await logWarning(
        "POST /api/users/update/[id]",
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
      await logWarning("POST /api/users/update/[id]", "Invalid API token");
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
      PRIVILEGES.EDIT,
    );

    if (!hasAddPermission) {
      await logWarning(
        "POST /api/users/update/[id]",
        "User lacks permission to update users.",
        { currentUserId },
      );
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: You do not have permission to Update users.",
        },
        { status: 403 },
      );
    }

    const isSuperAdmin = await isSuperAdminFromRequest();

    // ✅ Fetch existing user to check roles
    const existingUserResult = await executeStoredProcedure(
      "usp_GetSingleUser",
      { userId: numericUserId }, // ← was { userId }
      {},
    );

    const records = existingUserResult?.recordset;

    if (!records || records.length === 0) {
      await logWarning("POST /api/users/update/[id]", "User not found.", {
        userId,
      });
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    const roles = records.map((r) => ({
      roleId: r.roleId,
      roleName: r.roleName,
    }));

    const targetIsSuperAdmin = roles.some((role) =>
      isSuperAdminRoleId(role?.roleId),
    );
    if (targetIsSuperAdmin && !isSuperAdmin) {
      await logWarning(
        "POST /api/users/update/[id]",
        "Attempt to edit Super Admin by non-super-admin.",
        { currentUserId, userId },
      );
      return NextResponse.json(
        { message: "You are not allowed to edit Super Admin user." },
        { status: 403 },
      );
    }

    const { effectiveRoles, defaultedToAgent } = await resolveEffectiveRoles({
      rolesIds,
      orgIds,
    });

    if (!effectiveRoles.length) {
      return NextResponse.json(
        {
          message: "Please select any role before saving.",
        },
        { status: 400 },
      );
    }

    const agentRoleIds = await getAgentRoleIds();
    const hasSuperAdminRole = (rolesIds || []).some((role) =>
      isSuperAdminRoleId(role?.roleId ?? role),
    );
    const hasAgentRole = effectiveRoles.some((role) =>
      agentRoleIds.includes(Number(role?.roleId)),
    );
    if (hasSuperAdminRole && !isSuperAdmin) {
      return NextResponse.json(
        { message: "You are not allowed to assign Super Admin role." },
        { status: 403 },
      );
    }

    if (hasSuperAdminRole) {
      const onlyRootOrg =
        Array.isArray(orgIds) &&
        orgIds.length === 1 &&
        Number(orgIds[0]?.orgId) === 1;
      if (!onlyRootOrg) {
        return NextResponse.json(
          { message: "Super Admin must belong to root organization only." },
          { status: 400 },
        );
      }
    }

    if (hasAgentRole && Array.isArray(orgIds) && orgIds.length > 1) {
      return NextResponse.json(
        {
          message: defaultedToAgent
            ? "No role was selected, so Agent was applied by default. Agent users can be mapped to only one organization. Please select a single organization or choose a different role."
            : "Agent users can be mapped to only one organization. Please select a single organization or choose a different role.",
        },
        { status: 400 },
      );
    }

    // Convert rolesIds to JSON string
    const rolesIdsJson = JSON.stringify(effectiveRoles);

    // Convert orgIds to JSON string
    const orgIdsJson = orgIds
      ? JSON.stringify(orgIds.map(({ orgId }) => ({ orgId })))
      : "[]";

    // Call the stored procedure
    const result = await updateUserDetails({
      userId: numericUserId, // ← was userId
      loginId,
      email,
      userFullName,
      firstName,
      middleName,
      lastName,
      rolesIdsJson,
      phone,
      userAddress,
      isActive,
      orgIdsJson,
      currentUserId,
    });

    if (parseInt(result.output.statuscode) === 200) {
      await logAudit({
        userId: currentUserId,
        userName: currentUserName,
        actionType: "USER_UPDATED",
        description: `${currentUserName} updated ${userFullName}`,
      });
      await logSuccess(
        "POST /api/users/update/[id]",
        "User updated successfully.",
        {
          userId,
          currentUserId,
        },
      );
      return NextResponse.json(
        { success: true, message: result.output.outputmsg },
        { status: 200 },
      );
    } else {
      await logWarning("POST /api/users/update/[id]", result.output.outputmsg, {
        userId,
        currentUserId,
      });
      return NextResponse.json({
        success: false,
        message: result.output.outputmsg,
      });
    }
  } catch (error) {
    await logError("POST /api/users/update/[id]", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}

async function updateUserDetails({
  userId,
  loginId,
  email,
  userFullName,
  firstName,
  middleName,
  lastName,
  rolesIdsJson,
  phone,
  userAddress,
  isActive,
  orgIdsJson,
  currentUserId,
}) {
  const inputParams = {
    userId,
    userLoginId: loginId,
    Email: email,
    userFullName,
    firstName,
    middleName,
    lastName,
    Phone: phone,
    Address: userAddress,
    isActive,
    orgIds: orgIdsJson,
    rolesIds: rolesIdsJson,
    updatedBy: currentUserId,
  };

  const result = await executeStoredProcedure(
    "usp_UpdateUser",
    inputParams,
    outputmsgWithStatusCodeParams,
  );

  return result;
}
