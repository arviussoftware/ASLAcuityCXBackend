import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";

export async function PUT(request) {
  try {
    const body = await request.json();

    const {
      id,
      ruleName,
      sttEngine,
      apiKey,
      languageId,
      ruleEnabled,
      updatedBy,
    } = body;

    if (
      isInvalid(id) ||
      isInvalid(ruleName) ||
      isInvalid(sttEngine) ||
      isInvalid(apiKey) ||
      isInvalid(languageId) ||
      isInvalid(updatedBy)
    ) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 },
      );
    }

    await executeStoredProcedure("usp_UpdateSTTRule", {
      RuleId: Number(id),
      RuleName: String(ruleName).trim(),
      STTEngine: String(sttEngine).trim(),
      ApiKey: String(apiKey).trim(),
      LanguageId: Number(languageId),
      RuleEnabled: ruleEnabled === false ? 0 : 1,
      UpdatedBy: Number(updatedBy),
    });

    return NextResponse.json({
      success: true,
      message: "STT rule updated successfully",
    });
  } catch (error) {
    console.error("[updateSTTRule] error:", error.message);

    // ✅ Return actual SQL RAISERROR message instead of generic error
    const isSqlUserError =
      error?.number !== undefined ||
      error?.class === 16 ||
      error?.message?.includes("already exists") ||
      error?.message?.includes("not found") ||
      error?.message?.includes("cannot be empty");

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
