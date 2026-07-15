import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

// Main API Handler
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const Platformid = parseInt(searchParams.get("Platformid"));

    if (!Platformid || isNaN(Platformid)) {
      return NextResponse.json(
        { message: "Valid Platformid is required.", data: [] },
        { status: 400 },
      );
    }

    const destFields = await getAllDestinationFieldsDDL(Platformid);

    // Validate and process the result
    if (destFields.recordset && destFields.recordset.length > 0) {
      return NextResponse.json(
        {
          message:
            destFields.output.outputmsg || "Dropdown returned successfully.",
          destFieldList: destFields.recordset,
        },
        { status: destFields.output.statuscode || 200 },
      );
    } else {
      console.warn("No Destination Fields found.");
      return NextResponse.json(
        { message: "No Destination fields found.", destFieldList: [] },
        { status: 404 },
      );
    }
  } catch (error) {
    console.error("Error in CustomFields API:", error);
    return NextResponse.json(
      { message: "Internal server error.", error: error.message },
      { status: 500 },
    );
  }
}

// Helper function to execute the stored procedure
async function getAllDestinationFieldsDDL(Platformid) {
  const result = await executeStoredProcedure("usp_DestinationfieldsDDL", {
    Platformid,
  });
  return result;
}
