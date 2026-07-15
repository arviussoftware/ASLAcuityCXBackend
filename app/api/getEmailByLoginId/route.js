// app/api/getEmailByLoginId/route.js

import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError } from "@/lib/errorLogger";

export async function POST(request) {
  try {
    const { loginId } = await request.json();

    if (!loginId) {
      return NextResponse.json(
        { success: false, message: "Login ID is required" },
        { status: 200 },
      );
    }

    const result = await executeStoredProcedure("usp_GetEmailByLoginId", {
      loginId,
    });

    const [spResponse] = result.recordset || [];

    if (!spResponse) {
      return NextResponse.json(
        { success: false, message: "Login ID does not exist" },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        userId: spResponse.userId,
        email: spResponse.email || "",
      },
      { status: 200 },
    );
  } catch (err) {
    logError("POST /api/getEmailByLoginId", err);
    console.error("Get email by loginId error:", err);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
