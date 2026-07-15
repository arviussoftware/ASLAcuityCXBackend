import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

// Main API Handler
export async function GET() {
  try {
    const languages = await getAllLanguagesDDL();

    // Validate and process the result
    if (languages.recordset && languages.recordset.length > 0) {
      return NextResponse.json(
        {
          message:
            languages.output?.outputmsg || "Languages fetched successfully.",
          languageList: languages.recordset,
        },
        { status: languages.output?.statuscode || 200 },
      );
    } else {
      console.warn("No Languages found.");
      return NextResponse.json(
        { message: "No languages found.", languageList: [] },
        { status: 404 },
      );
    }
  } catch (error) {
    console.error("Error in Language API:", error);
    return NextResponse.json(
      { message: "Internal server error.", error: error.message },
      { status: 500 },
    );
  }
}

// Helper function to execute the stored procedure
async function getAllLanguagesDDL() {
  const result = await executeStoredProcedure("usp_GetLanguageDDL");
  return result;
}
