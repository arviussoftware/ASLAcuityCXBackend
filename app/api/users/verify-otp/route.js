// app/api/users/verify-otp/route.js

import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export async function POST(request) {
  try {
    const rawBody = await request.text();

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (jsonErr) {
      console.error("[verify-otp] Failed to parse JSON body:", jsonErr);
      return NextResponse.json(
        { success: false, message: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const { otp, email } = body;
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.split(" ")[1];

    if (!token || token !== process.env.NEXT_PUBLIC_API_TOKEN) {
      await logWarning(
        "POST /api/users/verify-otp",
        "Unauthorized request - invalid token.",
      );
      return NextResponse.json(
        { success: false, message: "Unauthorized request." },
        { status: 401 },
      );
    }

    if (!otp || !email) {
      await logWarning("POST /api/users/verify-otp", "Missing OTP or email.", {
        otp: !!otp,
        email: !!email,
      });
      return NextResponse.json(
        { success: false, message: "OTP and email are required." },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure("usp_VerifyUserOTP", {
      otp,
    });

    if (!result?.recordset || !Array.isArray(result.recordset)) {
      await logError(
        "POST /api/users/verify-otp",
        new Error("SP did not return recordset"),
        { otp, email },
      );
      return NextResponse.json(
        { success: false, message: "Database error: No recordset returned." },
        { status: 500 },
      );
    }

    const spRow = result.recordset[0];

    const isValid = spRow?.isValid;
    const userId = spRow?.userId;
    const isExpired = spRow?.isExpired;

    if (!isValid) {
      await logWarning(
        "POST /api/users/verify-otp",
        isExpired ? "OTP expired." : "Invalid OTP.",
        { email, isExpired },
      );
      return NextResponse.json(
        {
          success: false,
          message: isExpired ? "OTP expired." : "Invalid OTP.",
          reason: isExpired ? "expired" : "invalid",
        },
        { status: 200 },
      );
    }

    await logSuccess("POST /api/users/verify-otp", "OTP verified successfully.", {
      email,
      userId,
    });

    return NextResponse.json({
      success: true,
      message: "OTP verified successfully.",
      userId,
    });
  } catch (error) {
    await logError("POST /api/users/verify-otp", error); // ← ADD THIS
    console.error("[verify-otp] Unexpected server error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
