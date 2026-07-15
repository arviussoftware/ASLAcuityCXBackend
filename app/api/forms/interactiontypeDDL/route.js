export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: Missing token",
        },
        { status: 401 },
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: Invalid token",
        },
        { status: 401 },
      );
    }

    const result = await executeStoredProcedure(
      "usp_GetInteractionTypeDDL",
      {},
    );

    return NextResponse.json({
      success: true,
      data: result.recordset || [],
    });
  } catch (error) {
    console.error("Error fetching interaction type ddl:", error);

    return NextResponse.json(
      {
        success: false,
        message: error.message,
      },
      { status: 500 },
    );
  }
}
