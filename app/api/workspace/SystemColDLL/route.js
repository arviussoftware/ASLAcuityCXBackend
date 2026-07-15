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

    const result = await executeStoredProcedure("usp_SystemColDDL", {
      Platformid,
    });

    const fixedColumns = result.recordsets?.[0] || [];
    const dynamicColumns = result.recordsets?.[1] || [];

    return NextResponse.json(
      {
        message: result.output?.outputmsg || "Dropdown returned successfully.",
        fixedColumns: fixedColumns,
        customFieldList: dynamicColumns,
      },
      { status: result.output?.statuscode || 200 },
    );
  } catch (error) {
    console.error("Error in CustomFields API:", error);

    return NextResponse.json(
      {
        message: "Internal server error.",
        error: error.message,
      },
      { status: 500 },
    );
  }
}
