import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSuperAdminRoleId, isSuperAdminRoleId } from "@/lib/auth/superAdmin";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const token = request.cookies.get("sessionToken")?.value;
    if (!token) {
      return NextResponse.json(
        { authenticated: false, message: "No session token." },
        { status: 401 },
      );
    }

    const secretKey = new TextEncoder().encode(process.env.API_SECRET_KEY);
    const verified = await jwtVerify(token, secretKey);
    const payload = verified?.payload || {};

    const roles = payload.userRole || payload.userRoles || payload.roles || [];
    const isSuperAdmin = Array.isArray(roles)
      ? roles.some((r) => isSuperAdminRoleId(r?.roleId))
      : false;

    return NextResponse.json(
      {
        authenticated: true,
        userId: payload.userId ?? null,
        userFullName: payload.userFullName ?? payload.userName ?? null,
        roles: Array.isArray(roles) ? roles : [],
        isSuperAdmin,
        superAdminRoleId: getSuperAdminRoleId(),
        licensedModules: Array.isArray(payload?.licensedModules) ? payload.licensedModules : [],
        licenseExpiry: payload?.licenseExpiry || null,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate" },
      },
    );
  } catch {
    return NextResponse.json(
      { authenticated: false, message: "Invalid session token." },
      { status: 401 },
    );
  }
}
