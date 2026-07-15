// app/api/organization/root/route.js
import { executeStoredProcedure } from "@/lib/sql.js";
import OrganizationModel from "@/lib/models/organizationmodel";
import { logError, logSuccess } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId") ?? null; // null triggers the unfiltered branch

    const organizations = await getOrganizations(userId);

    const orgRows = organizations.recordsets?.[0] || organizations.recordset || [];
    const statusRows = organizations.recordsets?.[1] || [];

    const orgData = buildHierarchy(orgRows);
    const statusCounts = mapStatusCounts(statusRows);

    await logSuccess("GET /api/organization/root", {
      message: "Organizations fetched successfully",
      organizationCount: orgData.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Organizations fetched successfully",
        organizations: orgData,
        counts: statusCounts,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error) {
    logError("GET /api/organization/root", error);
    console.error("Error occurred while processing GET request:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function getOrganizations(userId = null) {
  try {
    const result = await executeStoredProcedure("usp_GetOrganizations", {
      p_userid: userId, // passes NULL if not provided
    });
    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw error;
  }
}

function mapStatusCounts(statusArray) {
  const statusMap = {
    Active: 0,
    Inactive: 0,
    "Soft Deleted": 0,
    Unknown: 0,
  };

  statusArray.forEach((item) => {
    statusMap[item.Status] = item.OrgCount;
  });

  return statusMap;
}

function buildHierarchy(records) {
  const orgMap = {};
  let rootNode = null;

  records.forEach((org) => {
    orgMap[org.id] = new OrganizationModel(
      org.id,
      org.Name,
      org.Description,
      org.parentId,
      [],
      org.isActive
    );
  });

  records.forEach((org) => {
    const node = orgMap[org.id];

    if (org.id === 1 && org.parentId === 1) {
      rootNode = node;
    } else {
      const parentNode = orgMap[org.parentId];
      if (parentNode) {
        parentNode.children.push(node);
      } else {
        console.warn(`Parent node with id ${org.parentId} not found for node ${org.id}`);
      }
    }
  });

  return rootNode ? [rootNode] : [];
}
