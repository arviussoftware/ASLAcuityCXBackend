// app/api/users/check-otp-status/route.js
// app/api/users/check-otp-status/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export async function GET(req) {
  const email = req.nextUrl.searchParams.get("email");

  if (!email) {
    await logWarning(
      "GET /api/users/check-otp-status",
      "Missing email query parameter.",
    );
    return NextResponse.json(
      { success: false, message: "Email query parameter is required." },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await executeStoredProcedure("usp_CheckOtpStatus", { email });
  } catch (err) {
    await logError("GET /api/users/check-otp-status", err); // ← ADD THIS
    console.error("[check-otp-status] SP execution error:", err);
    return NextResponse.json(
      { success: false, message: "Database error: " + err.message },
      { status: 500 },
    );
  }

  if (!result?.recordset || !Array.isArray(result.recordset)) {
    await logError(
      "GET /api/users/check-otp-status",
      new Error("SP did not return recordset"),
      { email },
    );
    return NextResponse.json(
      { success: false, message: "Invalid database response." },
      { status: 500 },
    );
  }

  const spRow = result.recordset[0];

  const isExpired = spRow?.isExpired === 1;

  await logSuccess("GET /api/users/check-otp-status", "OTP status checked successfully.", {
    email,
    isExpired,
  });

  return NextResponse.json({
    success: true,
    isExpired,
  });
}
