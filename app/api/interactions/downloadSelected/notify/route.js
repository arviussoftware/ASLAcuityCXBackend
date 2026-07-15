import { NextResponse } from "next/server";
import { logError } from "@/lib/errorLogger";
import { sendExportNotificationEmail } from "@/lib/sendExportNotificationEmail";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(req) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await req.json();
    if (!String(body.userEmail || "").trim()) {
      return NextResponse.json(
        { success: false, message: "Email is required." },
        { status: 400 },
      );
    }

    await sendExportNotificationEmail(body);
    return NextResponse.json({
      success: true,
      message: "Export notification email sent successfully.",
    });
  } catch (error) {
    await logError("POST /api/interactions/downloadSelected/notify", error);
    return NextResponse.json(
      {
        success: false,
        message: error.message || "Failed to send export notification email.",
      },
      { status: 500 },
    );
  }
}
