import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

const OUTPUT_PARAMS = [
  { name: "statuscode", type: "Int", direction: "output" },
  { name: "outputmsg", type: "VarChar", size: 255, direction: "output" },
];

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (
      !authHeader?.startsWith("Bearer ") ||
      authHeader.split(" ")[1] !== API_SECRET_TOKEN
    ) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { interactionId } = body;

    if (isInvalid(interactionId)) {
      return NextResponse.json(
        { success: false, message: "InteractionId is required" },
        { status: 400 }
      );
    }

    const result = await executeStoredProcedure(
      "usp_RetryFailedTranscription",
      {
        InteractionId: String(interactionId),
      },
      OUTPUT_PARAMS
    );

    const statusCode = Number(result?.output?.statuscode ?? 500);
    const outputMsg = String(result?.output?.outputmsg ?? "Unknown error");

    if (statusCode === 200) {
      return NextResponse.json({
        success: true,
        message: outputMsg,
      });
    }

    return NextResponse.json(
      { success: false, message: outputMsg },
      { status: statusCode >= 400 ? statusCode : 500 }
    );
  } catch (error) {
    await logError("POST /api/workFlow/retryTranscription", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
