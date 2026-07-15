import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const Platformid = parseInt(searchParams.get("Platformid"));

    if (!Platformid || isNaN(Platformid)) {
      return NextResponse.json(
        { message: "Valid Platformid is required.", data: [] },
        { status: 400 },
      );
    }

    const result = await getColumnMapping(Platformid);

    if (result.recordset && result.recordset.length > 0) {
      return NextResponse.json(
        {
          message:
            result.output?.outputmsg || "Column mapping fetched successfully.",
          success: true,
          data: result.recordset,
        },
        { status: result.output?.statuscode || 200 },
      );
    } else {
      return NextResponse.json(
        { message: "No column mapping found.", success: true, data: [] },
        { status: 200 },
      );
    }
  } catch (error) {
    console.error("Error in getColumnMapping API:", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
        error: error.message,
        success: false,
      },
      { status: 500 },
    );
  }
}

async function getColumnMapping(Platformid) {
  return await executeStoredProcedure("usp_GetColumnMapping", { Platformid });
}
