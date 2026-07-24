// app/api/integrationWorkspace/Transcription/STTEngineDDL/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { checkAuthOnly } from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const authErr = checkAuthOnly(request);
    if (authErr) return authErr;

    const result = await executeStoredProcedure("usp_GetSTTEngineDDL", {}, [
      { name: "OutputMsg" },
      { name: "StatusCode" },
    ]);

    const output = result.output || {};
    const statusCode = Number(output.StatusCode ?? output.statuscode ?? 200);
    const outputMsg = output.OutputMsg ?? output.outputmsg ?? "Success";

    const providerList = result.recordsets?.[0] || result.recordset || [];

    if (statusCode === 200) {
      return NextResponse.json(
        { message: outputMsg, providerList },
        { status: 200 },
      );
    }

    return NextResponse.json(
      { message: outputMsg, providerList: [] },
      { status: statusCode >= 400 ? statusCode : 500 },
    );
  } catch (error) {
    console.error("Error in Transcription Provider API:", error.message);
    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 },
    );
  }
}
