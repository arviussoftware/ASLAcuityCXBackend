import { executeStoredProcedure } from "@/lib/sql";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const result = await executeStoredProcedure("usp_GetRoles");

   // First result set
    const roles = result.recordsets[0];         // Second result set

    const response = new Response(
      JSON.stringify({
        success: true,
        message: "Organizations and forms fetched successfully",
        roles
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );

    return response;
  } catch (error) {
    console.error("Error executing GetOrganizationsAndForms procedure:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Internal server error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
