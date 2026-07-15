import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

const OUTPUT_PARAMS = [
  { name: "statuscode", type: "Int", direction: "output" },
  { name: "outputmsg", type: "VarChar", size: 255, direction: "output" },
];

/**
 * GET /api/workFlow/getRuleStats
 * Returns statistics for all enabled rules (pending, saved, error counts)
 * 
 * Response:
 * {
 *   success: true,
 *   data: [
 *     {
 *       RuleId: 13,
 *       RuleName: "Sales Calls",
 *       Priority: "high",
 *       STT_Engine: "5",
 *       PendingCount: 150,
 *       SavedCount: 1200,
 *       ErrorCount: 25,
 *       TotalCount: 1375,
 *       SuccessRate: 97.96,
 *       LastUpdated: "2026-05-07T10:30:00.000Z"
 *     }
 *   ]
 * }
 */
export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (
      !authHeader?.startsWith("Bearer ") ||
      authHeader.split(" ")[1] !== API_SECRET_TOKEN
    ) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const result = await executeStoredProcedure(
      "usp_GetRuleStats",
      {},
      OUTPUT_PARAMS
    );

    const statusCode = Number(result?.output?.statuscode ?? 500);
    const outputMsg = String(result?.output?.outputmsg ?? "Unknown error");

    if (statusCode === 200) {
      const data = result?.recordset ?? [];

      return NextResponse.json({
        success: true,
        message: outputMsg,
        data: data,
        summary: {
          totalRules: data.length,
          totalPending: data.reduce((sum, r) => sum + (r.PendingCount || 0), 0),
          totalSaved: data.reduce((sum, r) => sum + (r.SavedCount || 0), 0),
          totalError: data.reduce((sum, r) => sum + (r.ErrorCount || 0), 0),
          overallSuccessRate: calculateOverallSuccessRate(data),
        },
      });
    }

    return NextResponse.json(
      { success: false, message: outputMsg },
      { status: statusCode >= 400 ? statusCode : 500 }
    );
  } catch (error) {
    console.error("[getRuleStats]", error.message);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workFlow/getRuleStats
 * Manually trigger statistics update and return updated stats
 */
export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (
      !authHeader?.startsWith("Bearer ") ||
      authHeader.split(" ")[1] !== API_SECRET_TOKEN
    ) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    // Update statistics
    const updateResult = await executeStoredProcedure("usp_UpdateRuleStats", {});
    const data = updateResult?.recordset ?? [];

    return NextResponse.json({
      success: true,
      message: "Statistics updated successfully",
      data: data,
      summary: {
        totalRules: data.length,
        totalPending: data.reduce((sum, r) => sum + (r.PendingCount || 0), 0),
        totalSaved: data.reduce((sum, r) => sum + (r.SavedCount || 0), 0),
        totalError: data.reduce((sum, r) => sum + (r.ErrorCount || 0), 0),
        overallSuccessRate: calculateOverallSuccessRate(data),
      },
    });
  } catch (error) {
    console.error("[getRuleStats POST]", error.message);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}

function calculateOverallSuccessRate(data) {
  const totalSaved = data.reduce((sum, r) => sum + (r.SavedCount || 0), 0);
  const totalError = data.reduce((sum, r) => sum + (r.ErrorCount || 0), 0);
  const totalProcessed = totalSaved + totalError;
  
  if (totalProcessed === 0) return 0;
  return Number(((totalSaved / totalProcessed) * 100).toFixed(2));
}
