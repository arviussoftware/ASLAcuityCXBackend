//app/api/organization/UserDetailsGet/[id]/route.js
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { isValidPositiveInteger } from "@/lib/generic";

export async function GET(req, { params }) {
  const { id } = await params;

  if (!isValidPositiveInteger(id)) {
    await logWarning("GET /api/organization/UserDeatilsGet/[id]", {
      message: "Invalid or missing organization ID",
    });
    return new Response(
      JSON.stringify({
        success: false,
        message: "Invalid or missing organization ID",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  try {
    const result = await executeStoredProcedure(
      "usp_getusersbyorganizationforuserprofileview",
      {
        OrganizationId: id,
      },
    );

    const users = result.recordset;

    if (!users || users.length === 0) {
      await logSuccess("GET /api/organization/UserDeatilsGet/[id]", {
        message: "No users found for this organization",
        id,
        userCount: 0,
      });
      return new Response(
        JSON.stringify({
          success: true,
          message: "No users found for this organization",
          users: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    await logSuccess("GET /api/organization/UserDeatilsGet/[id]", {
      message: "Users fetched successfully",
      id,
      userCount: users.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Users fetched successfully",
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
    logError("GET /api/organization/UserDeatilsGet/[id]", error);
    console.error("Error fetching users by organization:", error);

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
