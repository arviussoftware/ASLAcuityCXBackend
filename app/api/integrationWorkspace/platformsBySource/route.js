import { isInvalid } from "@/lib/generic";
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");

    // ✅ Get SourceId from query params
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get("sourceId");

    // 🔐 Auth check
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    // ❗ Validate inputs
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Logged-in user ID is missing or invalid." },
        { status: 400 },
      );
    }

    if (isInvalid(sourceId)) {
      return NextResponse.json(
        { message: "SourceId is missing or invalid." },
        { status: 400 },
      );
    }

    // 🔐 (Optional) Privilege check
    // await checkUserPrivilege(loggedInUserId, MODULES.SOME_MODULE, PRIVILEGES.VIEW);

    // 📦 Call Stored Procedure
    const data = await executeStoredProcedure("usp_GetPlatformsBySourceId", {
      SourceId: parseInt(sourceId),
    });

    const platforms = data.recordsets[0];

    return NextResponse.json({
      success: true,
      message: "Platforms fetched successfully",
      data: platforms,
    });
  } catch (error) {
    console.error("Error occurred while fetching platforms:", error);

    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 },
    );
  }
}
