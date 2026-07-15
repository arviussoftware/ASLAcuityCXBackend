import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 }
      );
    }

    // currentUserId request se le — session/token se
    const { searchParams } = new URL(request.url);
    const currentUserId = searchParams.get("userId") || 1;

    const result = await executeStoredProcedure(
      "usp_GetMetaDataMainVerintColumns",
      {
        currentUserId: Number(currentUserId),
      },
      outputmsgWithStatusCodeParams
    );

    // Check statuscode jo procedure return karta hai
    if (result.output?.statuscode === 403) {
      return NextResponse.json(
        { success: false, message: result.output?.outputmsg },
        { status: 403 }
      );
    }

    const columns = (result.recordset || [])
      .map((item) => item.ColumnName)
      .filter(Boolean);

    return NextResponse.json({
      success: true,
      message: result.output?.outputmsg || "Metadata columns fetched successfully",
      data: columns,
    });

  } catch (error) {
    console.error("Error fetching metadata columns:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch metadata columns" },
      { status: 500 }
    );
  }
}
