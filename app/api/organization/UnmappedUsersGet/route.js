// app/api/organization/UnmappedUsersGet/route.js

// app/api/organization/UnmappedUsersGet/route.js
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

function normalizeDbValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value);
}

export async function GET() {
  try {
    // Fetches users from TblMst_UserDetails who have NO entry in TblMap_UserAgentOrganization
    const result = await executeStoredProcedure("usp_getunmappedusers");

    const rows = result.recordset || result.recordsets?.[0] || [];
    const users = rows.map((user) => ({
      userId: Number(user.userid),
      user_login_id: normalizeDbValue(user.user_login_id),
      user_full_name: normalizeDbValue(user.user_full_name),
      email: normalizeDbValue(user.email),
      phone: normalizeDbValue(user.phone),
      is_active: Number(user.is_active),
    }));

    if (!users || users.length === 0) {
      await logWarning("GET /api/organization/UnmappedUsersGet", {
        message: "No unmapped users found",
      });
      return new Response(
        JSON.stringify({
          success: false,
          message: "No unmapped users found",
          users: [],
        }),
        {
          status: 200, // Still 200 so UI can handle empty state gracefully
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    await logSuccess("GET /api/organization/UnmappedUsersGet", {
      message: "Unmapped users fetched successfully",
      userCount: users.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Unmapped users fetched successfully",
        users,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );
  } catch (error) {
    logError("GET /api/organization/UnmappedUsersGet", error);
    console.error("Error fetching unmapped users:", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Internal server error",
        error: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
