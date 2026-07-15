import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql";

export async function GET(request) {
  const type = request.nextUrl.searchParams.get("type");

  const map = {
    workspace: "usp_GetWorkspaceDDL",
    submenu: "usp_GetWorkspaceSubmenuDDL",
    provider: "usp_GetTranscriptionProviderDDL",
    language: "usp_GetLanguageDDL",
  };

  const procedure = map[type];

  if (!procedure) {
    return NextResponse.json({ success: false, message: "Invalid type" });
  }

  const result = await executeStoredProcedure(procedure);

  return NextResponse.json({
    success: true,
    data: result.recordsets[0],
  });
}
