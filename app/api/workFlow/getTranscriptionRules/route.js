import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import {
  OUTPUT_PARAMS,
  checkAuthOnly,
  toIntParam,
  readSpResult,
  ok,
  internal,
} from "@/lib/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const requestId = crypto.randomUUID();
  try {
    const authErr = checkAuthOnly(request);
    if (authErr) return authErr;

    const { searchParams } = new URL(request.url);
    const pageNumber = toIntParam(searchParams.get("pageNumber")) ?? 1;
    const pageSize = toIntParam(searchParams.get("pageSize")) ?? 10;

    // 1. Define parameters matching the SP signature EXACTLY
    const params = {
      PageNumber: pageNumber,
      PageSize: pageSize,
    };

    const outputParams = [
      { name: "TotalCount" },
      { name: "OutputMsg" },
      { name: "StatusCode" },
    ];

    // 2. Execute SP
    const result = await executeStoredProcedure(
      "usp_GetTranscriptionRules",
      params,
      outputParams
    );

    // 3. Extract outputs manually to handle case-sensitivity and SP naming
    const output = result.output || {};
    const statusCode = Number(output.StatusCode ?? output.statuscode ?? 200);
    const outputMsg = output.OutputMsg ?? output.outputmsg ?? "Success";

    if (statusCode === 200) {
      const rules = result.recordsets?.[0] || result.recordset || [];
      const mappings = result.recordsets?.[1] || [];

      // Group mappings by rule ID
      const mappingMap = {};
      for (const row of mappings) {
        const key = row.TranscriptionRuleId ?? row.RuleId ?? row.ruleId;
        if (!key) continue;
        if (!mappingMap[key]) mappingMap[key] = [];
        mappingMap[key].push({
          orgId: row.OrganizationId ?? row.orgId ?? row.OrgId,
          orgName: row.org_name ?? row.OrganizationName ?? row.OrgName ?? null,
          agentId: row.AgentId ?? row.agentId ?? null,
          agentName: row.AgentName ?? row.agentName ?? null,
          loginId: row.LoginId ?? row.loginId ?? null,
        });
      }

      // Merge rules with their mappings and deduplicate by RuleId
      const seenIds = new Set();
      const data = [];
      
      for (const rule of rules) {
        // Robustly detect the rule ID from various possible column names
        const ruleId = rule.RuleId ?? rule.RuleID ?? rule.TranscriptionRuleId ?? rule.ruleId ?? rule.id;
        
        if (!ruleId || seenIds.has(String(ruleId))) continue;
        
        seenIds.add(String(ruleId));
        data.push({
          ...rule,
          RuleId: ruleId,
          orgAgentMappings: mappingMap[ruleId] ?? [],
        });
      }

      const totalRecords = output.TotalCount ?? output.totalcount ?? data.length;
      const totalPages = Math.ceil(totalRecords / pageSize) || 1;

      return NextResponse.json({
        success: true,
        message: outputMsg,
        data,
        pagination: {
          currentPage: pageNumber,
          pageSize,
          totalRecords: String(totalRecords),
          totalPages,
          hasNextPage: pageNumber < totalPages,
          hasPreviousPage: pageNumber > 1,
        },
      });
    }

    // Handle non-200 status codes from SP
    return NextResponse.json(
      { success: false, message: outputMsg },
      { status: statusCode >= 400 ? statusCode : 500 }
    );
  } catch (error) {
    console.error(`[getTranscriptionRules] requestId=${requestId}`, error.message);
    return NextResponse.json(
      { success: false, message: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
