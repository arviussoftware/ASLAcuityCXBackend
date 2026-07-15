import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { getAuditUser, logAudit } from "@/lib/auditLogger";
import { isInvalid } from "@/lib/generic";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request, { params }) {
  try {
    const authHeader = request.headers.get("authorization");
    const formIdToUpdate = parseInt(params.id);
    // 🔐 Step 2: Check if token is missing or incorrect
    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (isInvalid(formIdToUpdate)) {
      return NextResponse.json(
        {
          success: false,
          message: "Request body or parameter could not be read properly.",
        },
        { status: 400 },
      );
    }
    const { Status, currentUserId, formName, auditAction } =
      await request.json();
    // Update form by ID
    const result = await UpdateFormById(formIdToUpdate, Status, currentUserId);
    const { StatusCode, Message } = result.recordset[0]; // Assuming a single record is returned

    if (StatusCode === 200) {
      const auditUser = await getAuditUser(currentUserId);
      const actionType =
        auditAction ||
        {
          2: "FORM_HIDDEN",
          3: "FORM_STAGED",
          5: "FORM_PUBLISHED",
          1: "FORM_UNSTAGED",
        }[Status] ||
        "FORM_STATUS_UPDATED";

      const descriptionMap = {
        FORM_HIDDEN: `Hidden form '${formName || formIdToUpdate}'.`,
        FORM_STAGED: `Staged form '${formName || formIdToUpdate}'.`,
        FORM_PUBLISHED: `Published form '${formName || formIdToUpdate}'.`,
        FORM_UNSTAGED: `Unstaged form '${formName || formIdToUpdate}'.`,
        FORM_UNHIDDEN: `Unhide form '${formName || formIdToUpdate}'.`,
        FORM_STATUS_UPDATED: `Updated status for form '${formName || formIdToUpdate}'.`,
      };

      await logAudit({
        userId: auditUser.userId,
        userName: auditUser.userName,
        actionType,
        description:
          descriptionMap[actionType] || descriptionMap.FORM_STATUS_UPDATED,
      });

      return NextResponse.json(
        { success: true, message: Message },
        { status: 200 },
      );
    } else if (StatusCode === 404) {
      return NextResponse.json(
        { success: false, message: Message },
        { status: 404 },
      );
    } else {
      return NextResponse.json(
        { success: false, message: Message },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Error in Update request:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

async function UpdateFormById(id, Status, currentUserId) {
  const inputParams = {
    formIdToUpdate: id,
    Status,
    currentUserId,
  };

  const result = await executeStoredProcedure(
    "usp_UpdateFormStatus",
    inputParams,
    outputmsgWithStatusCodeParams,
  );
  return result;
}
