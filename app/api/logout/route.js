import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logAudit } from "@/lib/auditLogger";

export async function POST(req) {
  try {
    // ✅ Get user info from header
    const userId = req.headers.get("loggedInUserId");
    const userName = req.headers.get("userName");
    const reason = req.headers.get("logoutReason");

    // ✅ Insert audit log
    if (userId) {
      await logAudit({
        userId,
        userName,
        // actionType: "LOGOUT",
        actionType: reason === "timeout" ? "SESSION_TIMEOUT" : "LOGOUT",
        // description: "User logged out of system",
        description:
          reason === "timeout"
            ? `${userName} session expired due to inactivity`
            : `${userName} logged out of the system`,
      });
    }

    const response = NextResponse.json({ message: "Logged out successfully" });

    const isProduction = process.env.NODE_ENV === "production";
    const isHttps = req.url.startsWith("https");

    response.cookies.set("sessionToken", "", {
      httpOnly: true,
      secure: isProduction && isHttps,
      path: "/",
      sameSite: "Lax",
    });

    return response;
  } catch (error) {
    console.error("Error in logout API:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
