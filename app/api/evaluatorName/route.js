// app/api/evaluatorName/route.js

// app/api/evaluatorName/route.js
import { isInvalid } from "@/lib/generic";
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");
    const orgIds = request.headers.get("orgIds") || request.headers.get("orgId");

    // Validate auth token
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate user ID
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Logged-in user ID is missing or invalid." },
        { status: 400 }
      );
    }

    // Check privilege
    const hasViewPermission = await checkUserPrivilege(
      loggedInUserId,
      MODULES.REPORTS,
      PRIVILEGES.VIEW,
      orgIds || null
    );

    if (!hasViewPermission) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: No permission to view report.",
        },
        { status: 403 }
      );
    }

    // Call the stored procedure
    const data = await executeStoredProcedure("usp_GetEvaluatorNames");
    const evaluators = data.recordsets[0];

    return NextResponse.json({
      success: true,
      message: "Evaluator names fetched successfully",
      data: evaluators,
    });
  } catch (error) {
    console.error("Error occurred while fetching evaluator names:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
