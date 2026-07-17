// lib/users/userCreation.js
import nodemailer from "nodemailer";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export const strictEmailRegex =
  /^[a-zA-Z0-9]+([._%+-]?[a-zA-Z0-9]+)*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const trimValue = (value) =>
  typeof value === "string"
    ? value.trim()
    : value == null
      ? ""
      : String(value).trim();

export const normalizeIdList = (items, key) =>
  Array.isArray(items)
    ? items
        .map((item) => Number(item?.[key]))
        .filter((value) => Number.isInteger(value) && value > 0)
        .map((value) => ({ [key]: value }))
    : [];

export const hasSelectedIds = (items, key) =>
  normalizeIdList(items, key).length > 0;

export function normalizeUserInput(rawUser = {}) {
  const userLoginId = trimValue(
    rawUser.userLoginId || rawUser.userName,
  ).toLowerCase();
  const email = trimValue(rawUser.email).toLowerCase();
  const firstName = trimValue(rawUser.firstName);
  const middleName = trimValue(rawUser.middleName);
  const lastName = trimValue(rawUser.lastName);
  const phone = trimValue(rawUser.phone);
  const userAddress = trimValue(rawUser.userAddress || rawUser.address);

  return {
    userLoginId,
    email,
    firstName,
    middleName,
    lastName,
    phone,
    userAddress,
  };
}

export function validateUserInput(user) {
  const errors = [];

  if (!user.userLoginId) errors.push("User Name is required.");
  if (!user.firstName) errors.push("First Name is required.");
  if (!user.lastName) errors.push("Last Name is required.");

  if (user.userLoginId.length > 50) errors.push("User Name length exceeded.");
  if (user.email.length > 50) errors.push("Email length exceeded.");
  if (user.firstName.length > 100) errors.push("First Name length exceeded.");
  if (user.middleName.length > 100) errors.push("Middle Name length exceeded.");
  if (user.lastName.length > 100) errors.push("Last Name length exceeded.");
  if (user.userAddress.length > 512) errors.push("Address length exceeded.");

  if (user.email && !strictEmailRegex.test(user.email)) {
    errors.push("Invalid email format.");
  }

  if (user.phone && !/^\d{10}$/.test(user.phone)) {
    errors.push("Phone number must be exactly 10 digits.");
  }

  if (/https?:\/\/[^\s]+/.test(user.userAddress)) {
    errors.push("Address must not contain a URL.");
  }

  return errors;
}

export async function getAgentRoleIds() {
  const result = await executeStoredProcedure("Usp_getAgentRoles");

  return (result?.recordsets?.[0] || [])
    .map((item) => Number(item?.user_role_id))
    .filter((roleId) => Number.isInteger(roleId) && roleId > 0);
}

export async function getAssignableRolesForOrganizations(orgIds) {
  const normalizedOrgIds = normalizeIdList(orgIds, "orgId");

  if (!normalizedOrgIds.length) {
    return [];
  }

  const result = await executeStoredProcedure("usp_GetRolesByOrg", {
    orgIds: JSON.stringify(normalizedOrgIds),
  });

  return (result?.recordset || []).map((role) => ({
    roleId: Number(role?.roleId),
    roleName: role?.roleName || "",
  }));
}

export async function resolveEffectiveRoles({ rolesIds, orgIds }) {
  const normalizedRoles = normalizeIdList(rolesIds, "roleId");

  if (normalizedRoles.length) {
    return {
      effectiveRoles: normalizedRoles,
      defaultedToAgent: false,
      defaultRoleName: null,
    };
  }

  const [agentRoleIds, assignableRoles] = await Promise.all([
    getAgentRoleIds(),
    getAssignableRolesForOrganizations(orgIds),
  ]);

  const defaultAgentRole = assignableRoles.find((role) =>
    agentRoleIds.includes(Number(role.roleId)),
  );

  return {
    effectiveRoles: defaultAgentRole
      ? [{ roleId: Number(defaultAgentRole.roleId) }]
      : [],
    defaultedToAgent: Boolean(defaultAgentRole),
    defaultRoleName: defaultAgentRole?.roleName || null,
  };
}

export async function insertUserDetails({
  userLoginId,
  email,
  firstName,
  middleName,
  lastName,
  phone,
  userAddress,
  rolesIds,
  orgIds,
  currentUserId,
}) {
  return executeStoredProcedure(
    "usp_InsertUser",
    {
      userLoginId,
      email,
      firstName,
      middleName,
      lastName,
      phone,
      address: userAddress,
      rolesIds,
      orgIds,
      creationBy: currentUserId,
    },
    outputmsgWithStatusCodeParams,
  );
}

export function parseStoredProcedureResult(spResult) {
  const statusCode = Number(spResult?.output?.statuscode || 500);
  const message = spResult?.output?.outputmsg || "Unknown error occurred.";
  const otpMatch = /OTP: *(\d{6})/.exec(message);

  return {
    statusCode,
    message,
    otp: otpMatch ? otpMatch[1] : null,
    isSuccess:
      statusCode === 200 && message.startsWith("User created successfully"),
  };
}

export async function sendVerificationEmail({
  email,
  firstName,
  loginId,
  otp,
}) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: false,
    requireTLS: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // TLS certificate validation enabled (rejectUnauthorized defaults to true)
  });

  const baseUrl = process.env.REACT_APP_BASE_URL;
  const verificationUrl = `${baseUrl}/OTP?email=${encodeURIComponent(email)}`;

  await transporter.sendMail({
    from: `"Verify ASL AcuityCx" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Verify your account and set your password",
    html: `
      <p>Hi ${firstName},</p>
      <p>Your account has been created successfully.</p>
      <p>Your LoginId is: ${loginId}</p>
      <p>Your OTP is: <strong>${otp}</strong></p>
      <p>Click here to verify your OTP:</p>
      <p><a href="${verificationUrl}">Verify your OTP</a></p>
      <p>This link will expire in 10 minutes. Please verify as soon as possible.</p>
    `,
  });
}
