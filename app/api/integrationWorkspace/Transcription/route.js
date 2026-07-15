import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export async function GET() {
  try {
    const result = await executeStoredProcedure("usp_GetSTTRules", {});

    const data = Array.isArray(result) ? result : (result?.recordset ?? []);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[getSTTRules] error:", error.message);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
