import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql";
import { isInvalid } from "@/lib/generic";

export async function POST(request) {
  try {
    const body = await request.json();

    const { workspace_id, submenu_id, provider_id, language_id, created_by } =
      body;

    if (
      isInvalid(workspace_id) ||
      isInvalid(submenu_id) ||
      isInvalid(provider_id) ||
      isInvalid(language_id) ||
      isInvalid(created_by)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing required fields",
        },
        { status: 400 },
      );
    }

    await executeStoredProcedure("usp_SaveWorkspaceIntegration", {
      workspace_id,
      submenu_id,
      provider_id,
      language_id,
      created_by,
    });

    return NextResponse.json({
      success: true,
      message: "Configuration saved successfully",
    });
  } catch (error) {
    console.error("Workspace integration error:", error);

    return NextResponse.json(
      {
        success: false,
        message: error.message,
      },
      { status: 500 },
    );
  }
}
