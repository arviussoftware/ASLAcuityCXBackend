// app/api/generateForgotPasswordOtpByLoginId/route.js

import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError } from "@/lib/errorLogger";
import nodemailer from "nodemailer";

export async function POST(request) {
  try {
    const { loginId, email } = await request.json();

    if (!loginId || !email) {
      return NextResponse.json(
        { success: false, message: "Login ID and Email are required" },
        { status: 200 },
      );
    }

    const result = await executeStoredProcedure(
      "usp_GenerateForgotPasswordOtp_ByLoginId",
      { loginId, email },
    );

    const [spResponse] = result.recordset || [];

    if (!spResponse || spResponse.success !== 1) {
      return NextResponse.json(
        {
          success: false,
          message: spResponse?.message || "Failed to generate OTP",
        },
        { status: 200 },
      );
    }

    const otp = spResponse.otp;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      requireTLS: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // TLS certificate validation enabled (rejectUnauthorized defaults to true)
    });

    const baseUrl = process.env.REACT_APP_BASE_URL;
    const verificationUrl = `${baseUrl}/OTP?email=${encodeURIComponent(email)}`;

    const mailOptions = {
      from: `"Verify ASL AcuityCx" <${process.env.SMTP_USER}>`,
      to: email,
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

    await transporter.sendMail(mailOptions);

    return NextResponse.json(
      { success: true, message: "OTP sent successfully." },
      { status: 200 },
    );
  } catch (err) {
    logError("POST /api/generateForgotPasswordOtpByLoginId", err);
    console.error("Generate OTP by loginId error:", err);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
