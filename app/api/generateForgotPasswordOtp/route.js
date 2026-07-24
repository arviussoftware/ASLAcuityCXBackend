// app/api/generateForgotPasswordOtp/route.js

import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError } from "@/lib/errorLogger";
import { isInvalid } from "@/lib/generic";
import { isRateLimited } from "@/lib/rateLimit";
import nodemailer from "nodemailer";

export async function POST(request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip") || "127.0.0.1";
    if (isRateLimited(ip, "generate-otp-email", 3, 60 * 1000)) {
      return NextResponse.json(
        { success: false, message: "Too many requests. Please try again in a minute." },
        { status: 429 }
      );
    }

    const { emailOrUsername } = await request.json();

    if (isInvalid(emailOrUsername)) {
      return NextResponse.json(
        { success: false, message: "Email or Username is required" },
        { status: 200 },
      );
    }

    const result = await executeStoredProcedure(
      "usp_GenerateForgotPasswordOtp",
      { userEmail: emailOrUsername },
    );

    const [spResponse] = result.recordset || [];

    if (!spResponse) {
      return NextResponse.json(
        { success: false, message: "Unexpected error occurred." },
        { status: 500 },
      );
    }

    if (spResponse.success !== 1) {
      return NextResponse.json(
        {
          success: false,
          message: spResponse.message || "Failed to generate OTP",
        },
        { status: 200 },
      );
    }

    const otp = spResponse.otp;
    const toEmail = emailOrUsername;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      requireTLS: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // TLS certificate validation enabled (rejectUnauthorized defaults to true)
    });

    const baseUrl = process.env.REACT_APP_BASE_URL;
    const verificationUrl = `${baseUrl}/OTP?email=${encodeURIComponent(toEmail)}`;

    const mailOptions = {
      from: `"Verify ASL AcuityCx" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: "Your Password Reset OTP",
      html: `
        <p>Hi,</p>
        <p>You requested to reset your password.</p>
        <p>Your OTP code is: <strong>${otp}</strong></p>
        <p>Click here to verify your OTP:</p>
        <p>👉 <a href="${verificationUrl}">Verify your OTP</a></p>
        <p>This link will expire after 10 minutes. If you did not request this, please ignore this email.</p>
      `,
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (emailErr) {
      logError("POST /api/generateForgotPasswordOtp - sendMail", emailErr);
      console.error("Failed to send OTP email:", emailErr);
    }

    return NextResponse.json(
      { success: true, message: "OTP generated and sent to your email." },
      { status: 200 },
    );
  } catch (err) {
    logError("POST /api/generateForgotPasswordOtp", err);
    console.error("Generate OTP error:", err);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
