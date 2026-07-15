// app/api/organizationDDL/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const userIdHeader = request.headers.get("loggedInUserId");
    const userId = userIdHeader ? parseInt(userIdHeader, 10) : null;

    const result = await executeStoredProcedure(
      "public.usp_GetOrganizations", // schema.routineName format
      { p_userid: userId },           // named input params as object
      []                              // no output params needed
    );

    // The lib handles cursors — orgs are in recordsets[0], counts in recordsets[1]
    const organizations = result.recordsets?.[0] || result.recordset || [];
    const counts = result.recordsets?.[1] || [];

    if (organizations.length === 0) {
      return NextResponse.json(
        { message: "Organizations not found." },
        { status: 404 }
      );
    }

    const organizationList = buildOrganizationTree(organizations);

    return NextResponse.json(
      {
        message: "Success",
        organizationList,
        counts, // optional — remove if not needed by frontend
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Organization API Error:", error);

    return NextResponse.json(
      { message: error.message },
      { status: 500 }
    );
  }
}

function buildOrganizationTree(organizations) {
  const map = new Map();
  const roots = [];

  organizations.forEach((org) => {
    map.set(org.id, {
      id: org.id,
      label: org.Name,
      description: org.Description,
      value: org.id,
      isActive: org.isActive,
      isDisabled: org.isActive === 0,
      children: [],
    });
  });

  organizations.forEach((org) => {
    const node = map.get(org.id);

    if (
      org.parentId === null ||
      org.parentId === 0 ||
      org.parentId === org.id ||
      !map.has(org.parentId)
    ) {
      roots.push(node);
    } else {
      map.get(org.parentId)?.children.push(node);
    }
  });

  return roots;
}