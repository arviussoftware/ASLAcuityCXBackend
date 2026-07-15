//app/api/organization/UserMappingSave/route.js
import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { organizationId, createdBy, users } = await request.json();

    if (!organizationId) {
      await logWarning("POST /api/organization/UserMappingSave", {
        message: "OrganizationId is required.",
      });
      return NextResponse.json(
        { success: false, message: "OrganizationId is required." },
        { status: 400 },
      );
    }

    if (!users || users.length === 0) {
      await logWarning("POST /api/organization/UserMappingSave", {
        message: "Users list is required.",
        organizationId,
      });
      return NextResponse.json(
        { success: false, message: "Users list is required." },
        { status: 400 },
      );
    }

    // 👇 JSON stringify
    const usersJson = JSON.stringify(users);

    const result = await executeStoredProcedure(
      "usp_insertbulkuserwithroleandorganization",
      {
        usersJson: usersJson,
        organization_id: organizationId,
        creation_by: createdBy,
      },
      outputmsgWithStatusCodeParams,
    );

    const statusCode = parseInt(result?.output?.statuscode || 500, 10);
    const message = result?.output?.outputmsg || "Users mapped successfully";

    if (statusCode === 200) {
      await logSuccess("POST /api/organization/UserMappingSave", {
        message,
        organizationId,
        userCount: users.length,
      });
    } else {
      await logWarning("POST /api/organization/UserMappingSave", {
        message,
        organizationId,
        statusCode,
        userCount: users.length,
      });
    }

    return NextResponse.json(
      {
        success: statusCode === 200,
        message,
      },
      { status: statusCode },
    );
  } catch (error) {
    logError("POST /api/organization/UserMappingSave", error);
    console.error("Error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
      },
      { status: 500 },
    );
  }
}
