// app/api/organization/checkOrgAssociation/route.js

import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { isInvalid } from "@/lib/generic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const body = await request.json();
    const { OrgId } = body;

    // Step 1: Authorization check
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      await logWarning("POST /api/organization/checkOrgAssociation", {
        message: "Unauthorized: Token missing",
      });
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      await logWarning("POST /api/organization/checkOrgAssociation", {
        message: "Unauthorized: Invalid token",
      });
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 }
      );
    }

    // Step 2: Validation
    if (isInvalid(OrgId)) {
      await logWarning("POST /api/organization/checkOrgAssociation", {
        message: "Missing or invalid field: OrgId",
      });
      return NextResponse.json(
        { success: false, message: "Missing or invalid field: OrgId" },
        { status: 400 }
      );
    }

    // Step 3: Call stored procedure
    const result = await executeStoredProcedure("usp_checkorguserassociation", {
      OrgId,
    });

    const isAssociated = result.recordset?.[0]?.IsAssociated === 1;

    await logSuccess("POST /api/organization/checkOrgAssociation", {
      message: "Organization association checked successfully",
      OrgId,
      isAssociated,
    });

    return NextResponse.json({
      success: true,
      isAssociated,
    });
  } catch (error) {
    logError("POST /api/organization/checkOrgAssociation", error);
    console.error("Org association check failed:", error);
    return NextResponse.json(
      {
        success: false,
        message: "Internal Server Error: " + error.message,
      },
      { status: 500 }
    );
  }
}
