import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { organizationId, roleIds } = await request.json();

    if (!roleIds) {
      return NextResponse.json(
        { success: false, message: "Missing roleId in request body" },
        { status: 400 }
      );
    }

    if (!organizationId) {
      return NextResponse.json(
        { success: false, message: "Missing organizationId in request body" },
        { status: 400 }
      );
    }

    const inputParams = {
      organizationId: parseInt(organizationId),
      // pass roleIds as CSV string
      roleIds: roleIds.join(","),
    };

    const result = await executeStoredProcedure(
      "usp_GetRoleOrgFormMapping",
      inputParams,
      outputmsgWithStatusCodeParams
    );

    // Logging (optional for debug)

    const statusCode = parseInt(result.output?.statuscode);
    const message = result.output?.outputmsg;

    if (statusCode === 200) {
      return NextResponse.json(
        {
          success: true,
          message: message,
          mappings: result.recordset || [],
        },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        {
          success: false,
          message: message || "Procedure failed.",
          mappings: [],
        },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }
}
