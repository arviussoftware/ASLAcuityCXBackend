import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { userId, OrganizationId, isActive } = await request.json();

    if (!userId || !OrganizationId || isActive === undefined) {
      await logWarning("POST /api/organization/EditIsActive/[id]", {
        message: "Required fields missing.",
      });
      return NextResponse.json(
        {
          success: false,
          message: "Required fields missing.",
        },
        { status: 400 }
      );
    }

    const result = await executeStoredProcedure(
      "usp_editactiveinactiveorganization",
      {
        userId,
        OrganizationId,
        isActive,
      },
      outputmsgWithStatusCodeParams
    );

    if (parseInt(result.output.statuscode) === 200) {
      await logSuccess("POST /api/organization/EditIsActive/[id]", {
        message: result.output.outputmsg || "Organization status updated successfully",
        OrganizationId,
      });
      return NextResponse.json(
        { success: true, message: result.output.outputmsg },
        { status: 200 }
      );
    } else {
      await logWarning("POST /api/organization/EditIsActive/[id]", {
        message: result.output.outputmsg || "Organization status update failed.",
        OrganizationId,
        statusCode: result.output.statuscode,
      });
      return NextResponse.json({
        success: false,
        message: result.output.outputmsg,
      });
    }
  } catch (error) {
    logError("POST /api/organization/EditIsActive/[id]", error);
    console.error("Internal server error:", error);
    return NextResponse.json({
      success: false,
      message: "Internal server error.",
    });
  }
}
