// app/api/users/resend-otp/route.js

// app/api/users/resend-otp/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import nodemailer from "nodemailer";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export async function POST(req) {
  const authHeader = req.headers.get("authorization");

  const token = authHeader?.split(" ")[1];

  if (!token || token !== process.env.NEXT_PUBLIC_API_TOKEN) {
    await logWarning(
      "POST /api/users/resend-otp",
      "Unauthorized request - invalid token.",
    );
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    await logError("POST /api/users/resend-otp - JSON parse", err); // ← ADD THIS
    console.error("[resend-otp] Failed to parse JSON:", err);
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const email = body.email;

  if (!email) {
    await logWarning(
      "POST /api/users/resend-otp",
      "Missing email in request body.",
    );
    return NextResponse.json(
      { success: false, message: "Email is required." },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await executeStoredProcedure("usp_GenerateNewOtp", { email });
  } catch (err) {
    await logError("POST /api/users/resend-otp - DB", err); // ← ADD THIS
    console.error("[resend-otp] DB error:", err);
    return NextResponse.json(
      { success: false, message: "Database error: " + err.message },
      { status: 500 },
    );
  }

  const otp = result.recordset?.[0]?.otp;

  if (!otp) {
    await logError(
      "POST /api/users/resend-otp",
      new Error("SP did not return OTP"),
      { email },
    );
    return NextResponse.json(
      { success: false, message: "Failed to generate new OTP." },
      { status: 500 },
    );
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
  const baseUrl = process.env.REACT_APP_BASE_URL;
  const verificationUrl = `${baseUrl}/OTP?email=${encodeURIComponent(email)}`;
  console.log("verificationUrl is: ", verificationUrl);
  const mailOptions = {
    from: `"Verify ASL AcuityCx" <${process.env.SMTP_USER}>`,
    to: email,
    subject: "Your new OTP",
    html: `
    <p>Hi,</p>
    <p>You requested a new OTP.</p>
    <p>Your new OTP code is: <strong>${otp}</strong></p>
    <p>Click here to verify your OTP:</p>
    <p>👉 <a href="${verificationUrl}">Verify your OTP</a></p>
    <p>This link will expire after 10 minutes. If you did not request this, please ignore this email.</p>
  `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    await logSuccess("POST /api/users/resend-otp", "OTP resent successfully.", {
      email,
    });
  } catch (err) {
    await logError("POST /api/users/resend-otp - Email", err); // ← ADD THIS
    console.error("[resend-otp] Failed to send email:", err);
    return NextResponse.json(
      { success: false, message: "Failed to send OTP email." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    message: `New OTP sent to ${email}.`,
  });
}
