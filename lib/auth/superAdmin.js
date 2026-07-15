import { cookies } from "next/headers";
import { jwtVerify } from "jose";

export function getSuperAdminRoleId() {
  const raw = process.env.SUPER_ADMIN_ROLE_ID;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isSuperAdminRoleId(roleId) {
  const superRoleId = getSuperAdminRoleId();
  if (!superRoleId) return false;
  return Number(roleId) === Number(superRoleId);
}

export async function isSuperAdminFromRequest() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("sessionToken")?.value;
    if (!token) return false;
    const secretKey = new TextEncoder().encode(process.env.API_SECRET_KEY);
    const verified = await jwtVerify(token, secretKey);

    const payload = verified?.payload || {};
    // Support multiple payload shapes we have in the app:
    // - payload.userRole (array)
    // - payload.userRoles (array)
    // - payload.roles (array)
    const roles =
      payload.userRole || payload.userRoles || payload.roles || [];

    if (!Array.isArray(roles)) return false;
    return roles.some((r) => isSuperAdminRoleId(r?.roleId ?? r));
  } catch {
    return false;
  }
}
