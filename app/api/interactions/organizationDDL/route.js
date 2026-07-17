import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const loggedInUserId = request.headers.get("loggedInUserId");

    if (!loggedInUserId) {
      console.error("Missing or undefined loggedInUserId in headers");
      return NextResponse.json(
        {
          message:
            "Headers are missing or undefined: loggedInUserId is required.",
        },
        { status: 400 }
      );
    }

    const organizationDetails = await getAllOrganizationsDDL(loggedInUserId);

    if (
      organizationDetails.recordset &&
      organizationDetails.recordset.length > 0
    ) {
      const organizationList = buildOrganizationTree(
        organizationDetails.recordset
      );

      const response = NextResponse.json(
        {
          message:
            organizationDetails.output.outputmsg ||
            "Organization dropdown returned successfully.",
          organizationList,
        },
        { status: organizationDetails.output.statuscode || 200 }
      );
      response.headers.set(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
      );
      return response;
    } else {
      console.warn("No organizations found for user:", loggedInUserId);
      return NextResponse.json(
        { message: "No organizations found.", organizationList: [] },
        { status: 404 }
      );
    }
  } catch (error) {
    await logError("GET /api/interactions/organizationDDL", error);
    return NextResponse.json(
      { message: "Internal server error." },
      { status: 500 }
    );
  }
}

async function getAllOrganizationsDDL(loggedInUserId) {
  const inputParams = { currentUserid: loggedInUserId };
  const outputParams = [
    { name: "outputmsg", type: "nvarchar", value: "" },
    { name: "statuscode", type: "int", value: 0 },
  ];

  const result = await executeStoredProcedure(
    "usp_OrganizationDDLForInteraction",
    inputParams,
    outputParams
  );

  return result;
}

function buildOrganizationTree(organizations) {
  const map = new Map();
  const roots = [];

  // Step 1: Create a map of all nodes
  organizations.forEach((org) => {
    const { orgId, org_name, parentId, isActive } = org;

    if (!orgId || !org_name) {
      console.warn("Skipping invalid organization node:", org);
      return;
    }

    map.set(orgId, {
      id: orgId,
      name: org_name,
      parentId,
      isActive,
      children: [],
    });
  });

  // Step 2: Build the tree structure
  organizations.forEach((org) => {
    const { orgId, parentId } = org;
    const node = map.get(orgId);

    // Treat as root if parentId === orgId or no valid parent exists
    if (!parentId || parentId === orgId || !map.has(parentId)) {
      roots.push(node);
    } else {
      // Attach to its parent
      const parent = map.get(parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        console.warn(`Orphan node detected (no parent found):`, node);
      }
    }
  });
  return roots;
}
