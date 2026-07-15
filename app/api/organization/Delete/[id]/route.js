import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { isInvalid, isValidPositiveInteger } from "@/lib/generic";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const resolvedParams = await params;
    if (!isValidPositiveInteger(resolvedParams?.id)) {
      await logWarning("POST /api/organization/Delete/[id]", {
        message: "Invalid or missing organization ID.",
      });
      return NextResponse.json(
        {
          success: false,
          message: "Invalid or missing organization ID.",
          statusCode: 400,
        },
        { status: 400 },
      );
    }
    const organizationId = parseInt(resolvedParams.id);

    if (isInvalid(organizationId)) {
      await logWarning("POST /api/organization/Delete/[id]", {
        message: "Invalid or missing organization ID.",
      });
      return NextResponse.json(
        {
          success: false,
          message: "Invalid or missing organization ID.",
          statusCode: 400,
        },
        { status: 400 },
      );
    }

    const result = await deleteOrganizationById(organizationId);

    const { StatusCode, Message } = result.recordset[0];

    if (StatusCode === 200) {
      await logSuccess("POST /api/organization/Delete/[id]", {
        message: Message || "Organization deleted successfully",
        organizationId,
      });
    } else {
      await logWarning("POST /api/organization/Delete/[id]", {
        message: Message || "Organization delete failed.",
        organizationId,
        StatusCode,
      });
    }

    return NextResponse.json(
      {
        success: StatusCode === 200,
        message: Message,
        statusCode: StatusCode, // ✅ ADD THIS
      },
      { status: 200 }, // Always respond with 200 for frontend to parse
    );
  } catch (error) {
    logError("POST /api/organization/Delete/[id]", error);
    return NextResponse.json(
      {
        success: false,
        message: "Internal server error",
        statusCode: 500,
      },
      { status: 500 },
    );
  }
}

async function deleteOrganizationById(id) {
  const inputParams = {
    OrganizationId: id,
  };

  // Call stored procedure
  const result = await executeStoredProcedure(
    "usp_deleteorganization",
    inputParams,
    outputmsgWithStatusCodeParams,
  );

  return result;
}
