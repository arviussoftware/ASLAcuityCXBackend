import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  try {
    const { id } = params; // 👈 from /api/workspace/configuration/[id]

    if (!id) {
      return NextResponse.json(
        { success: false, message: "appid is required" },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure("usp_getconfigurationbyId", {
      appid: id,
    });

    if (result.recordset && result.recordset.length > 0) {
      return NextResponse.json({
        success: true,
        data: result.recordset[0], // 👈 IMPORTANT (single record)
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          message: "No record found",
        },
        { status: 404 },
      );
    }
  } catch (error) {
    console.error("Error in API:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
        error: error.message,
      },
      { status: 500 },
    );
  }
}
