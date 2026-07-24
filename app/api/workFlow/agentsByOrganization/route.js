import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const orgIds = searchParams.getAll("orgId").map(Number).filter(Boolean);

    if (!orgIds.length) {
      return NextResponse.json(
        { message: "At least one orgId is required", agents: [] },
        { status: 400 },
      );
    }

    const results = [];
    for (const orgId of orgIds) {
      try {
        const result = await executeStoredProcedure(
          "usp_GetAgentsByOrganization",
          { OrgId: orgId }, // ← was { orgId } — align casing with InstanceId/PlatformId convention
          [{ name: "OutputMsg" }, { name: "StatusCode" }],
        );

        const output = result.output || {};
        const statusCode = Number(
          output.StatusCode ?? output.statuscode ?? 200,
        );
        if (statusCode !== 200) {
          await logError(
            `GET /api/workFlow/agentsByOrganization - orgId=${orgId}`,
            new Error(output.OutputMsg ?? output.outputmsg),
          );
          continue;
        }

        const rows = result.recordsets?.[0] || result.recordset || [];

        const mapped = rows.map((agent) => {
          const agentId =
            agent.agentId ??
            agent.AgentId ??
            agent.userId ??
            agent.UserId ??
            agent.id;
          const agentName =
            agent.agentName ?? agent.AgentName ?? agent.name ?? agent.label;
          const loginId = agent.loginId ?? agent.LoginId ?? agent.login_id;
          return {
            ...agent,
            agentId: agentId ? String(agentId) : null,
            agentName: agentName || "Unknown",
            loginId: loginId || null,
            orgId,
          };
        });
        results.push(...mapped);
      } catch (err) {
        await logError(
          `GET /api/workFlow/agentsByOrganization - orgId=${orgId}`,
          err,
        );
        console.error(`Error fetching agents for org ${orgId}:`, err);
      }
    }

    const agents = results.sort((a, b) =>
      (a.agentName || "").localeCompare(b.agentName || ""),
    );

    const response = NextResponse.json(
      { message: "Success", agents },
      { status: 200 },
    );
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    return response;
  } catch (error) {
    await logError("GET /api/workFlow/agentsByOrganization", error);
    console.error("Error in agentsByOrganization:", error);
    return NextResponse.json(
      { message: "Internal server error.", error: error.message, agents: [] },
      { status: 500 },
    );
  }
}
