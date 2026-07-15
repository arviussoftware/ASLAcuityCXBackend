// app/api/workFlow/agentsByOrganization/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    // Support multiple orgId params: ?orgId=1&orgId=2&orgId=3
    const orgIds = searchParams.getAll("orgId").map(Number).filter(Boolean);

    if (!orgIds.length) {
      return NextResponse.json(
        { message: "At least one orgId is required", agents: [] },
        { status: 400 }
      );
    }

    // Fetch agents for all orgs
    const results = [];
    for (const orgId of orgIds) {
      try {
        const params = { orgId };
        const result = await executeStoredProcedure("usp_GetAgentsByOrganization", params);
        
        // recordsets[0] or recordset
        const rows = result.recordsets?.[0] || result.recordset || [];

        const strictRows = rows.filter((agent) => {
          const agentOrgId =
            agent.orgId ??           
            agent.OrganizationId ??   
            agent.OrgId ??            
            null;

          if (agentOrgId === null) return true;
          return Number(agentOrgId) === orgId;
        });

        const mapped = strictRows.map((agent) => {
          const agentId = agent.agentId ?? agent.AgentId ?? agent.userId ?? agent.UserId ?? agent.id;
          const agentName = agent.agentName ?? agent.AgentName ?? agent.name ?? agent.label;
          const loginId = agent.loginId ?? agent.LoginId ?? agent.login_id;

          return {
            ...agent,
            agentId: agentId ? String(agentId) : null,
            agentName: agentName || "Unknown",
            loginId: loginId || null,
            orgId
          };
        });
        results.push(...mapped);
      } catch (err) {
        await logError(`GET /api/workFlow/agentsByOrganization - orgId=${orgId}`, err);
        console.error(`Error fetching agents for org ${orgId}:`, err);
        // Continue to other orgs instead of failing entire request
      }
    }

    const agents = results.sort((a, b) => (a.agentName || "").localeCompare(b.agentName || ""));

    const response = NextResponse.json(
      { message: "Success", agents },
      { status: 200 }
    );
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    return response;
  } catch (error) {
    await logError("GET /api/workFlow/agentsByOrganization", error);
    console.error("Error in agentsByOrganization:", error);
    return NextResponse.json(
      { message: "Internal server error.", error: error.message, agents: [] },
      { status: 500 }
    );
  }
}