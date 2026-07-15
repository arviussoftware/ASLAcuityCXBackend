//app/api/organization/DescriptionGet/[id]/route.js
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export async function GET(req, { params }) {
  const { id } = await params;

  if (!id) {
    await logWarning("GET /api/organization/DescriptionGet/[id]", {
      message: "Organization ID is required",
    });
    return new Response(
      JSON.stringify({
        success: false,
        message: "Organization ID is required",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  try {
    const result = await executeStoredProcedure("usp_GetOrganizationById", {
      id,
    });
    const dbOrg = result.recordset[0];

    if (!dbOrg) {
      await logWarning("GET /api/organization/DescriptionGet/[id]", {
        message: "Organization not found",
        id,
      });
      return new Response(
        JSON.stringify({
          success: false,
          message: "Organization not found",
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const organization = {
      id: dbOrg.id,
      Name: dbOrg.name,
      Description: dbOrg.description,
      parentId: dbOrg.parentid,
      isActive: dbOrg.isactive,
    };

    await logSuccess("GET /api/organization/DescriptionGet/[id]", {
      message: "Organization fetched successfully",
      id,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Organization fetched successfully",
        organization,
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
    logError("GET /api/organization/DescriptionGet/[id]", error);
    console.error("Error fetching organization details:", error);
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
