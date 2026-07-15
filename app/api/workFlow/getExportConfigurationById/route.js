import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { checkAuth, badReq, ok, internal, toIntParam } from "@/lib/route-helpers";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const authErr = checkAuth(request);
    if (authErr) return authErr;

    const { searchParams } = new URL(request.url);
    const id = toIntParam(searchParams.get("id"));
    if (!id) return badReq("id is required.");

    const result = await executeStoredProcedure(
      "usp_GetExportConfigurationById",
      { Id: id },  // plain number, no sql.Int wrapper
      {}           // no OUTPUT params
    );

    const row = result?.recordset?.[0] ?? null;

    if (!row) {
      return NextResponse.json(
        { success: false, message: "Configuration not found." },
        { status: 404 }
      );
    }

    return ok({ data: row });
  } catch (error) {
    const idVal = new URL(request.url).searchParams.get("id");
    await logError("GET /api/workFlow/getExportConfigurationById", error, { id: idVal });
    console.error("[getExportConfigurationById] id=%s error=%o",
      idVal,
      error
    );
    return internal();
  }
}