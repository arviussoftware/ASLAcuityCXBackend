// app/api/users/set-password/route.js

import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { getAuditUser, logAudit } from "@/lib/auditLogger";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { isRateLimited } from "@/lib/rateLimit";

export async function POST(request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "127.0.0.1";
    if (isRateLimited(ip, "set-password", 5, 60 * 1000)) {
      await logWarning("POST /api/users/set-password", "Rate limit exceeded.", { ip });
      return NextResponse.json(
        { success: false, message: "Too many password update attempts. Please try again in a minute." },
        { status: 429 }
      );
    }

    const { userId, newPassword } = await request.json();
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.split(" ")[1];

    if (!token || token !== process.env.NEXT_PUBLIC_API_TOKEN) {
      await logWarning(
        "POST /api/users/set-password",
        "Unauthorized request - invalid token.",
      );
      return NextResponse.json(
        { success: false, message: "Unauthorized request." },
        { status: 401 },
      );
    }

    if (!userId || !newPassword) {
      await logWarning(
        "POST /api/users/set-password",
        "Missing userId or newPassword.",
        { userId: !!userId },
      );
      return NextResponse.json(
        { success: false, message: "Missing userId or password." },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure(
      "usp_SetPassword",
      {
        userId: parseInt(userId),
        newPassword,
      },
      {},
    );

    const auditUser = await getAuditUser(userId);

    await logAudit({
      userId: auditUser.userId,
      userName: auditUser.userName,
      actionType: "FORGOT_PASSWORD_RESET",
      description: "User set a new password after OTP verification.",
    });

    await logSuccess("POST /api/users/set-password", "Password updated successfully.", {
      userId,
    });

    return NextResponse.json({
      success: true,
      message: "Password updated successfully.",
    });
  } catch (error) {
    await logError("POST /api/users/set-password", error); // ← ADD THIS
    console.error("Error setting password:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error." },
      { status: 500 },
    );
  }
}
