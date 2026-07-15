import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";

export async function POST(request) {
  try {
    const body = await request.json();

    const { ruleName, sttEngine, apiKey, languageId, ruleEnabled, createdBy } =
      body;

    if (
      isInvalid(ruleName) ||
      isInvalid(sttEngine) ||
      isInvalid(apiKey) ||
      isInvalid(languageId) ||
      isInvalid(createdBy)
    ) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 },
      );
    }

    await executeStoredProcedure("usp_SaveSTTRule", {
      RuleName: String(ruleName).trim(),
      STTEngine: String(sttEngine).trim(),
      ApiKey: String(apiKey).trim(),
      LanguageId: Number(languageId),
      RuleEnabled: ruleEnabled === false ? 0 : 1,
      CreatedBy: Number(createdBy),
    });

    return NextResponse.json({
      success: true,
      message: "STT rule saved successfully",
    });
  } catch (error) {
    console.error("[saveSTTRule] error:", error.message);

    const isSqlUserError =
      error?.number !== undefined ||
      error?.class === 16 ||
      error?.message?.includes("Duplicate found for");

    if (isSqlUserError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
