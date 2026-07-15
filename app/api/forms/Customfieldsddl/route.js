import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

// Main API Handler
export async function GET() {
  try {
    const customFields = await getAllCustomFieldsDDL();

    // Validate and process the result
    if (customFields.recordset && customFields.recordset.length > 0) {
      return NextResponse.json(
        {
          message:
            customFields.output.outputmsg || "Dropdown returned successfully.",
          customFieldList: customFields.recordset,
        },
        { status: customFields.output.statuscode || 200 }
      );
    } else {
      console.warn("No CustomFields found.");
      return NextResponse.json(
        { message: "No custom fields found.", customFieldList: [] },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error("Error in CustomFields API:", error);
    return NextResponse.json(
      { message: "Internal server error.", error: error.message },
      { status: 500 }
    );
  }
}

// Helper function to execute the stored procedure
async function getAllCustomFieldsDDL() {
  const result = await executeStoredProcedure("usp_CustomfieldsDDL");
  return result;
}
