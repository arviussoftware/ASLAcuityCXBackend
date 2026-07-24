import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const instanceId = searchParams.get("instanceId");
    const platformId = searchParams.get("platformId");

    if (!instanceId || !platformId) {
      return NextResponse.json(
        {
          message: "instanceId and platformId are required",
          organizationList: [],
        },
        { status: 400 },
      );
    }

    const params = {
      InstanceId: Number(instanceId),
      PlatformId: Number(platformId),
    };

    const result = await executeStoredProcedure(
      "usp_GetOrganizationsByInstance",
      params,
      [{ name: "OutputMsg" }, { name: "StatusCode" }],
    );

    const output = result.output || {};
    const statusCode = Number(output.StatusCode ?? output.statuscode ?? 200);
    const outputMsg = output.OutputMsg ?? output.outputmsg ?? "Success";
    const orgs = result.recordsets?.[0] || result.recordset || [];

    if (statusCode !== 200) {
      return NextResponse.json(
        { message: outputMsg, organizationList: [] },
        { status: statusCode >= 400 ? statusCode : 500 },
      );
    }

    const organizationList = buildOrganizationTree(orgs);

    const response = NextResponse.json(
      { message: outputMsg, organizationList },
      { status: 200 },
    );
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    return response;
  } catch (error) {
    await logError("GET /api/workFlow/organizationDDLByInstance", error);
    console.error("Error in organizationDDLByInstance:", error);
    return NextResponse.json(
      {
        message: "Internal server error.",
        error: error.message,
        organizationList: [],
      },
      { status: 500 },
    );
  }
}

function buildOrganizationTree(organizations) {
  // unchanged — already reads "OrgId"/"OrgName" correctly, matching the SP's quoted output columns
  const map = new Map();
  const roots = [];
  organizations.forEach((org) => {
    const orgId = org.OrgId ?? org.orgId ?? org.OrganizationId ?? org.id;
    const orgName =
      org.OrgName ??
      org.org_name ??
      org.OrganizationName ??
      org.Name ??
      org.label;
    const parentId = org.ParentId ?? org.parentId ?? org.parent_id;
    const isActive = org.IsActive ?? org.isActive ?? true;
    if (!orgId || !orgName) return;
    map.set(orgId, {
      id: orgId,
      label: orgName,
      parentId,
      isActive,
      children: [],
    });
  });
  organizations.forEach((org) => {
    const orgId = org.OrgId ?? org.orgId ?? org.OrganizationId ?? org.id;
    const parentId = org.ParentId ?? org.parentId ?? org.parent_id;
    const node = map.get(orgId);
    if (!node) return;
    if (!parentId || parentId === orgId || !map.has(parentId)) roots.push(node);
    else map.get(parentId).children.push(node);
  });
  return roots;
}
