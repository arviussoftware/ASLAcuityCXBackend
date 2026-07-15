import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { formId } = await request.json();

    if (!formId) {
      return NextResponse.json(
        { success: false, message: "Missing formId in request body" },
        { status: 400 }
      );
    }

    const inputParams = {
      formId: parseInt(formId),
    };

    const result = await executeStoredProcedure(
      "usp_GetFormOrgRoleMapping",  // 🆕 Your new SP
      inputParams,
      outputmsgWithStatusCodeParams
    );

    const statusCode = parseInt(result.output?.statuscode);
    const message = result.output?.outputmsg;

    if (statusCode === 200) {
      return NextResponse.json(
        {
          success: true,
          message,
          mappings: result.recordset || [],
        },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        {
          success: false,
          message: message || "No mappings found.",
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
