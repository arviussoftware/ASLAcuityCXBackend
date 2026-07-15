// app/api/timezone/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Fetch timezone data
    const data = await executeStoredProcedure("Usp_GetTimeZone");
    const timezone = data.recordsets[0] || [];

    return NextResponse.json({
      success: true,
      message: "Data fetched successfully",
      data: timezone,
    });
  } catch (error) {
    console.error("Error occurred while fetching timezones:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
