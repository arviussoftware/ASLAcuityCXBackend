import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { getAuditUser, logAudit } from "@/lib/auditLogger";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

// ✅ GET — fetch existing org mappings for this form
export async function GET(request, { params }) {
  try {
    const { id } = await params;

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 },
      );
    }
    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 },
      );
    }

    const result = await executeStoredProcedure(
      "usp_GetFormOrganizationMappings",
      { formId: parseInt(id) },
      outputmsgWithStatusCodeParams,
    );

    return NextResponse.json(
      { success: true, mappings: result.recordset || [] },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching form mappings:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

// ✅ POST — assign form to organizations
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const formId = id;
    const { orgIds: bodyOrgIds, currentUserId } = await request.json();

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 },
      );
    }
    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 },
      );
    }

    if (!formId) {
      return NextResponse.json(
        { success: false, message: "Form ID is required." },
        { status: 400 },
      );
    }

    if (!bodyOrgIds || !Array.isArray(bodyOrgIds) || bodyOrgIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "At least one organization must be selected.",
        },
        { status: 400 },
      );
    }

    const orgIdsString = bodyOrgIds.join(",");
    const result = await AssignForm(formId, orgIdsString, currentUserId);

    if (parseInt(result.output.statuscode) === 200) {
      const auditUser = await getAuditUser(currentUserId);
      await logAudit({
        userId: auditUser.userId,
        userName: auditUser.userName,
        actionType: "FORM_ASSIGNED",
        description: `Assigned form ID '${formId}' to organization(s): ${orgIdsString}.`,
      });

      return NextResponse.json(
        {
          success: true,
          message: result.output.outputmsg || "Form assigned successfully.",
        },
        { status: 200 },
      );
    } else {
      return NextResponse.json(
        { success: false, message: result.output.outputmsg },
        { status: parseInt(result.output.statuscode) },
      );
    }
  } catch (error) {
    console.error("Internal server error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

async function AssignForm(formId, orgIds, currentUserId) {
  try {
    const inputParams = {
      formId: parseInt(formId),
      orgIds,
      currentUserId: parseInt(currentUserId),
    };

    const result = await executeStoredProcedure(
      "usp_AssignFormToOrganizations",
      inputParams,
      outputmsgWithStatusCodeParams,
    );

    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error("Failed to assign the form.");
  }
}
