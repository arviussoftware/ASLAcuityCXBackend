import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 },
      );
    }
    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 },
      );
    }
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { success: false, message: "Logged-in user ID is missing or invalid." },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure("usp_GetDisplayNames", {}, [
      { name: "OutputMsg" },
      { name: "StatusCode" },
    ]);

    const output = result.output || {};
    const statusCode = Number(output.StatusCode ?? output.statuscode ?? 200);
    const outputMsg = output.OutputMsg ?? output.outputmsg ?? "Success";
    const displayNames = result.recordsets?.[0] || result.recordset || [];

    if (statusCode === 200) {
      return NextResponse.json(
        {
          success: true,
          message: outputMsg,
          data: displayNames,
          count: displayNames.length,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      { success: false, message: outputMsg },
      { status: statusCode >= 400 ? statusCode : 500 },
    );
  } catch (error) {
    await logError("GET /api/workFlow/coustomMetadataField", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
