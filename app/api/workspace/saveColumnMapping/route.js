import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export async function POST(req) {
  try {
    const body = await req.json();
    const { Platformid, appid, mappings, created_by } = body;

    const result = await executeStoredProcedure("usp_SaveColumnMapping", {
      Platformid: Platformid,
      appid: appid,
      mappingJson: JSON.stringify(mappings),
      created_by,
    });

    return NextResponse.json({
      message: "Column mapping saved successfully",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { message: "Failed to save mapping" },
      { status: 500 },
    );
  }
}
