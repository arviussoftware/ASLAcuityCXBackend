// app/api/display-names/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    // Get headers
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");

    // Validate token
    if (!authHeader || !authHeader.startsWith("Bearer")) {
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

    // Validate user ID
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { success: false, message: "Logged-in user ID is missing or invalid." },
        { status: 400 }
      );
    }

    // CORRECT: Call SP with empty object
    const result = await executeStoredProcedure("usp_GetDisplayNames", {});

    // Check if we got data
    if (result && result.recordset) {
      const displayNames = result.recordset || [];

      return NextResponse.json(
        {
          success: true,
          message: "Display names fetched successfully",
          data: displayNames,
          count: displayNames.length,
        },
        { status: 200 }
      );
    }
    // Alternative if recordsets is used
    if (result?.recordsets?.length > 0) {
      const displayNames = result.recordsets[0] || [];

      return NextResponse.json(
        {
          success: true,
          message: "Display names fetched successfully",
          data: displayNames,
          count: displayNames.length,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { success: false, message: "No data found" },
      { status: 404 }
    );

  } catch (error) {
    await logError("GET /api/workFlow/coustomMetadataField", error);
    console.error("API Error:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}