import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

// Main API Handler
export async function GET() {
  try {
    const providers = await getAllTranscriptionProvidersDDL();

    // Validate and process the result
    if (providers.recordset && providers.recordset.length > 0) {
      return NextResponse.json(
        {
          message:
            providers.output?.outputmsg ||
            "Transcription providers fetched successfully.",
          providerList: providers.recordset,
        },
        { status: providers.output?.statuscode || 200 },
      );
    } else {
      console.warn("No Transcription Providers found.");
      return NextResponse.json(
        { message: "No transcription providers found.", providerList: [] },
        { status: 404 },
      );
    }
  } catch (error) {
    console.error("Error in Transcription Provider API:", error);
    return NextResponse.json(
      { message: "Internal server error.", error: error.message },
      { status: 500 },
    );
  }
}

// Helper function to execute the stored procedure
async function getAllTranscriptionProvidersDDL() {
  const result = await executeStoredProcedure(
    "usp_GetTranscriptionProviderDDL",
  );
  return result;
}
