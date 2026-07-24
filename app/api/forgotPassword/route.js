// app\api\forgotPassword\route.js
import { NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";
import { isRateLimited } from "@/lib/rateLimit";

export async function POST(request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "127.0.0.1";
    if (isRateLimited(ip, "forgot-password", 5, 60 * 1000)) {
      return NextResponse.json(
        { success: false, message: "Too many password reset attempts. Please try again in a minute." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { username, newPassword } = body;

    const missingFields = [
      { name: "loginId/email", value: username },
      { name: "newPassword", value: newPassword },
    ].filter((f) => isInvalid(f.value));
    if (missingFields.length > 0) {
      const fieldNames = missingFields.map((f) => f.name).join(", ");
      return NextResponse.json(
        {
          success: false,
          message: `Missing or invalid fields: ${fieldNames}`,
        },
        { status: 400 }
      );
    }

    const inputParams = {
      loginId: username,
      userEmail: username,
      newPassword, // raw password
    };

    const result = await executeStoredProcedure(
      "usp_ForgetPassword",
      inputParams,
      outputmsgWithStatusCodeParams
    );

    const statusCode = parseInt(result.output?.statuscode || 500);
    const message = result.output?.outputmsg || "Unknown error.";

    return NextResponse.json(
      {
        success: statusCode === 200,
        message,
      },
      { status: statusCode }
    );
  } catch (err) {
    console.error("Password reset error:", err);
    return NextResponse.json(
      {
        success: false,
        message: "Internal Server Error: " + err.message,
      },
      { status: 500 }
    );
  }
}
