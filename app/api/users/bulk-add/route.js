// app/api/users/bulk-add/route.js
import { NextResponse } from "next/server";
import { logAudit } from "@/lib/auditLogger";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { isInvalid } from "@/lib/generic";
import {
  connectToDatabase,
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import {
  isSuperAdminFromRequest,
  isSuperAdminRoleId,
} from "@/lib/auth/superAdmin";
import {
  getAgentRoleIds,
  hasSelectedIds,
  normalizeUserInput,
  parseStoredProcedureResult,
  resolveEffectiveRoles,
  sendVerificationEmail,
  validateUserInput,
} from "@/lib/users/userCreation";
import { assertSafeTableName } from "@/lib/safeTableName";


export const dynamic = "force-dynamic";
export const maxDuration = 300; // ADD THIS — allow up to 5 minutes for large bulk uploads
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  process.env.NEXT_PUBLIC_CLIENT_ENCRYPT_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is not set");
}
const MAX_USERS_PER_ORG = 100;

const normalizeIdList = (items, key) =>
  Array.isArray(items)
    ? items
        .map((item) => Number(item?.[key]))
        .filter((value) => Number.isInteger(value) && value > 0)
        .map((value) => ({ [key]: value }))
    : [];

const collectDuplicateValues = (users, key, label) => {
  const seen = new Map();
  const duplicates = [];

  users.forEach((user, index) => {
    const value = user[key];
    if (!value) return;

    if (seen.has(value)) {
      duplicates.push(
        `${label} "${value}" is duplicated in rows ${seen.get(value)} and ${
          index + 2
        }.`,
      );
      return;
    }

    seen.set(value, index + 2);
  });

  return duplicates;
};

const collectExistingDatabaseConflicts = async (users) => {
  const loginIds = [
    ...new Set(users.map((user) => user.userLoginId).filter(Boolean)),
  ];
  const emails = [...new Set(users.map((user) => user.email).filter(Boolean))];

  if (!loginIds.length && !emails.length) {
    return { existingLoginIds: new Set(), existingEmails: new Set() };
  }

  const pool = await connectToDatabase();
  const normalizedLoginIds = loginIds.map((loginId) => loginId.toLowerCase());
  const normalizedEmails = emails.map((email) => email.toLowerCase());

  const loginRows = loginIds.length
    ? (
        await pool.query(
          `
            SELECT lower(trim(user_login_id)) AS "userLoginId"
            FROM public.tblmst_userdetails
            WHERE coalesce("DeleteStatus", 0) = 0
              AND lower(trim(user_login_id)) = ANY($1::text[])
          `,
          [normalizedLoginIds],
        )
      ).rows
    : [];

  const emailRows = emails.length
    ? (
        await pool.query(
          `
            SELECT lower(trim(pgp_sym_decrypt(email, $2))) AS email
            FROM public.tblmst_userdetails
            WHERE coalesce("DeleteStatus", 0) = 0
              AND email IS NOT NULL
              AND lower(trim(pgp_sym_decrypt(email, $2))) = ANY($1::text[])
          `,
          [normalizedEmails, ENCRYPTION_KEY],
        )
      ).rows
    : [];

  return {
    existingLoginIds: new Set(
      loginRows.map((row) => row.userLoginId).filter(Boolean),
    ),
    existingEmails: new Set(emailRows.map((row) => row.email).filter(Boolean)),
  };
};

const findOrganizationCapacityConflict = async (orgIds, incomingUsersCount) => {
  if (!Array.isArray(orgIds) || !orgIds.length || incomingUsersCount <= 0) {
    return null;
  }

  const pool = await connectToDatabase();
  const orgIdValues = orgIds
    .map((org) => Number(org?.orgId))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!orgIdValues.length) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT
        o."Id" AS "orgId",
        o.org_name AS "orgName",
        count(DISTINCT u."userId") AS "currentUserCount"
      FROM public.tblmst_organizations o
      LEFT JOIN public.tblmap_useragentorganization m
        ON m.org_id = o."Id"
      LEFT JOIN public.tblmst_userdetails u
        ON u."userId" = m.user_id
       AND coalesce(u."DeleteStatus", 0) = 0
      WHERE o."Id" = ANY($1::int[])
      GROUP BY o."Id", o.org_name
    `,
    [orgIdValues],
  );

  return (
    result.rows.find(
      (row) =>
        Number(row.currentUserCount || 0) + incomingUsersCount >
        MAX_USERS_PER_ORG,
    ) || null
  );
};

const buildDatabaseConflictErrors = async (users) => {
  const { existingLoginIds, existingEmails } =
    await collectExistingDatabaseConflicts(users);
  const errors = [];

  users.forEach((user, index) => {
    const rowNumber = index + 2;

    if (user.userLoginId && existingLoginIds.has(user.userLoginId)) {
      errors.push(
        `Row ${rowNumber} (${user.userLoginId}): A user with this User Name already exists. Please choose a different name.`,
      );
    }

    if (user.email && existingEmails.has(user.email)) {
      errors.push(
        `Row ${rowNumber} (${user.userLoginId || "no username"}): The provided email is already associated with another user.`,
      );
    }
  });

  return errors;
};

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const body = await request.json();

    const {
      users,
      rolesIds: rawRolesIds,
      orgIds: rawOrgIds,
      currentUserId,
      currentUserName,
    } = body;

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      await logWarning(
        "POST /api/users/bulk-add",
        "Missing or invalid Authorization header",
      );
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 },
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      await logWarning("POST /api/users/bulk-add", "Invalid API token");
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 },
      );
    }

    if (!Array.isArray(users) || users.length === 0) {
      await logWarning(
        "POST /api/users/bulk-add",
        "No users provided in bulk-add request.",
        { currentUserId },
      );
      return NextResponse.json(
        { success: false, message: "No users provided." },
        { status: 400 },
      );
    }

    const rolesIds = normalizeIdList(rawRolesIds, "roleId");
    const orgIds = normalizeIdList(rawOrgIds, "orgId");

    const missingFields = [
      {
        name: "orgIds",
        value: hasSelectedIds(orgIds, "orgId") ? orgIds : null,
      },
      { name: "currentUserId", value: currentUserId },
    ].filter((field) => isInvalid(field.value));

    if (missingFields.length > 0) {
      await logWarning(
        "POST /api/users/bulk-add",
        "Missing fields in bulk-add request.",
        { missingFields: missingFields.map((f) => f.name), currentUserId },
      );
      return NextResponse.json(
        {
          success: false,
          message: `Missing or invalid fields: ${missingFields
            .map((field) => field.name)
            .join(", ")}`,
        },
        { status: 400 },
      );
    }

    const hasAddPermission = await checkUserPrivilege(
      currentUserId,
      MODULES.USER_MANAGEMENT,
      PRIVILEGES.CREATE,
    );

    if (!hasAddPermission) {
      await logWarning(
        "POST /api/users/bulk-add",
        "User lacks permission to bulk-add users.",
        { currentUserId },
      );
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: You do not have permission to add users.",
        },
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
          success: false,
          message: "Please select any role before saving.",
        },
        { status: 400 },
      );
    }

    const isSuperAdmin = await isSuperAdminFromRequest();
    const agentRoleIds = await getAgentRoleIds();
    const hasSuperAdminRole = rolesIds.some((role) =>
      isSuperAdminRoleId(role?.roleId),
    );
    const hasAgentRole = effectiveRoles.some((role) =>
      agentRoleIds.includes(Number(role.roleId)),
    );

    if (hasSuperAdminRole && !isSuperAdmin) {
      return NextResponse.json(
        {
          success: false,
          message: "You are not allowed to assign Super Admin role.",
        },
        { status: 403 },
      );
    }

    if (
      hasSuperAdminRole &&
      !(orgIds.length === 1 && Number(orgIds[0]?.orgId) === 1)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Super Admin must belong to root organization only.",
        },
        { status: 400 },
      );
    }

    if (hasAgentRole && orgIds.length > 1) {
      return NextResponse.json(
        {
          success: false,
          message: defaultedToAgent
            ? "No role was selected, so Agent was applied by default. Agent users can be mapped to only one organization. Please select a single organization or choose a different role."
            : "Agent users can be mapped to only one organization. Please select a single organization or choose a different role.",
        },
        { status: 400 },
      );
    }

    const normalizedUsers = users.map((user) => normalizeUserInput(user));
    const validationErrors = [];

    normalizedUsers.forEach((user, index) => {
      const rowErrors = validateUserInput(user);
      if (rowErrors.length > 0) {
        validationErrors.push(
          `Row ${index + 2} (${user.userLoginId || "no username"}): ${rowErrors.join(" ")}`,
        );
      }
    });

    validationErrors.push(
      ...collectDuplicateValues(normalizedUsers, "userLoginId", "User Name"),
      ...collectDuplicateValues(normalizedUsers, "email", "Email"),
    );

    if (validationErrors.length > 0) {
      await logWarning(
        "POST /api/users/bulk-add",
        "Validation errors in bulk-add.",
        { errorCount: validationErrors.length, currentUserId },
      );
      return NextResponse.json(
        {
          success: false,
          message: "Please fix the highlighted bulk-upload rows and try again.",
          errors: validationErrors,
        },
        { status: 400 },
      );
    }

    const orgCapacityConflict = await findOrganizationCapacityConflict(
      orgIds,
      normalizedUsers.length,
    );

    if (orgCapacityConflict) {
      await logWarning(
        "POST /api/users/bulk-add",
        "Organization capacity limit reached.",
        { orgName: orgCapacityConflict.orgName, currentUserId },
      );
      return NextResponse.json(
        {
          success: false,
          message: `The organization "${orgCapacityConflict.orgName || "Selected organization"}" has reached the maximum limit of ${MAX_USERS_PER_ORG} users.`,
        },
        { status: 400 },
      );
    }

    const databaseConflictErrors =
      await buildDatabaseConflictErrors(normalizedUsers);

    if (databaseConflictErrors.length > 0) {
      await logWarning(
        "POST /api/users/bulk-add",
        "Database conflicts found in bulk-add.",
        { errorCount: databaseConflictErrors.length, currentUserId },
      );
      return NextResponse.json(
        {
          success: false,
          message:
            "Bulk upload was not saved because one or more users already exist. Fix the listed rows and try again.",
          errors: databaseConflictErrors,
        },
        { status: 400 },
      );
    }

    const rolesIdsJson = JSON.stringify(effectiveRoles);
    const orgIdsJson = JSON.stringify(orgIds);
    const createdUsers = [];

    for (let index = 0; index < normalizedUsers.length; index += 1) {
      const user = normalizedUsers[index];
      const spResult = await executeStoredProcedure(
        "usp_InsertUser",
        {
          userLoginId: user.userLoginId,
          email: user.email,
          firstName: user.firstName,
          middleName: user.middleName,
          lastName: user.lastName,
          phone: user.phone,
          address: user.userAddress,
          rolesIds: rolesIdsJson,
          orgIds: orgIdsJson,
          creationBy: currentUserId,
        },
        outputmsgWithStatusCodeParams,
      );

      const { message, otp, isSuccess } = parseStoredProcedureResult(spResult);

      if (!isSuccess) {
        await logError("POST /api/users/bulk-add", new Error(message), {
          row: index + 2,
          userLoginId: user.userLoginId,
        });
        return NextResponse.json(
          {
            success: false,
            message:
              "Bulk upload was not saved because one or more rows failed validation.",
            errors: [
              `Row ${index + 2} (${user.userLoginId || "no username"}): ${message}`,
            ],
          },
          { status: 400 },
        );
      }

      createdUsers.push({
        ...user,
        otp,
      });
    }

    // ── After the insert loop finishes (createdUsers is populated) ──
    const summary = `${createdUsers.length} of ${normalizedUsers.length} user${normalizedUsers.length > 1 ? "s" : ""} created successfully.`;

    await logSuccess(
      "POST /api/users/bulk-add",
      "Bulk users created successfully.",
      {
        currentUserId,
        totalCount: normalizedUsers.length,
        successCount: createdUsers.length,
      },
    );

    // Fire off all emails in PARALLEL, don't await the whole batch sequentially.
    const emailResults = await Promise.allSettled(
      createdUsers
        .filter((user) => user.otp && user.email)
        .map((user) =>
          sendVerificationEmail({
            email: user.email,
            firstName: user.firstName,
            loginId: user.userLoginId,
            otp: user.otp,
          }),
        ),
    );

    const emailSentCount = emailResults.filter(
      (r) => r.status === "fulfilled",
    ).length;
    const postCommitWarnings = emailResults
      .map((r, i) => (r.status === "rejected" ? createdUsers[i] : null))
      .filter(Boolean)
      .map(
        (user) =>
          `User ${user.userLoginId} was created, but the verification email could not be sent.`,
      );

    for (const user of createdUsers) {
      await logAudit({
        userId: currentUserId,
        userName: currentUserName,
        actionType: "USER_ADDED",
        description: `${currentUserName || "User"} added user ${user.userLoginId}`,
      });
    }

    const emailSummary =
      emailSentCount > 0
        ? ` Verification emails sent for ${emailSentCount} user(s).`
        : "";
    const warningSummary =
      postCommitWarnings.length > 0
        ? " Some verification emails could not be sent."
        : "";

    return NextResponse.json(
      {
        success: true,
        successCount: createdUsers.length,
        failCount: 0,
        totalCount: normalizedUsers.length,
        message: summary + emailSummary + warningSummary,
        errors: postCommitWarnings,
      },
      { status: 200 },
    );
  } catch (error) {
    await logError("POST /api/users/bulk-add", error);
    console.error("Unexpected server error during bulk user creation:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
