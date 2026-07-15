//app/api/organization/UserListGet/route.js
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export async function GET() {
  try {
    const result = await executeStoredProcedure(
      "usp_GetCiscoUsersOrganizationUpdate",
    );

    const users = result.recordset;

    if (!users || users.length === 0) {
      await logWarning("GET /api/organization/UserListGet", {
        message: "No Cisco users found with OrganizationUpdate = 0",
      });
      return new Response(
        JSON.stringify({
          success: false,
          message: "No Cisco users found with OrganizationUpdate = 0",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    await logSuccess("GET /api/organization/UserListGet", {
      message: "Cisco users fetched successfully",
      userCount: users.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Cisco users fetched successfully",
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
    logError("GET /api/organization/UserListGet", error);
    console.error("Error fetching Cisco users:", error);

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
