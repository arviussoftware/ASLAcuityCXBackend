import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request, { params }) {
  try {
    const { id: UniqueId } = await params;
    const loggedInUserId = request.headers.get("loggedInUserId");
    const interactionId = request.headers.get("interactionId");
    const authHeader = request.headers.get("authorization");
    const orgIds = request.headers.get("orgIds") || request.headers.get("orgId");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
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
        }
      );
    }

    if (
      isInvalid(loggedInUserId) ||
      isInvalid(interactionId) ||
      isInvalid(UniqueId)
    ) {
      return NextResponse.json(
        { message: "Missing or invalid parameters." },
        { status: 400 }
      );
    }

    const hasviewPermission = await checkUserPrivilege(
      loggedInUserId,
      MODULES.INTERACTION,
      PRIVILEGES.VIEW_SUBMITTED_FORM,
      orgIds || null
    );

    if (!hasviewPermission) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: You do not have permission to show Form.",
        },
        { status: 403 }
      );
    }

    const result = await getSubmittedFormByInteractionId(
      interactionId,
      UniqueId,
      loggedInUserId
    );

    if (result.recordset.length > 0) {
      const formattedResults = result.recordset.map((item) => ({
        id: item.id,
        interactionId: item.interaction_id,
        formId: item.Form_id,
        formName: item.form_name,
        formDescription: item.form_description,
        user_full_name: item.user_full_name,
        ansFormJson: JSON.parse(item.Ansform_json),
      }));

      return NextResponse.json(
        {
          message: "Forms retrieved successfully.",
          data: formattedResults,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ message: "No forms found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { message: `Server error: ${error.message}` },
      { status: 500 }
    );
  }
}

async function getSubmittedFormByInteractionId(
  interactionId,
  UniqueId,
  loggedInUserId
) {
  const inputParams = {
    interactionId,
    UniqueId,
    currentUserId: loggedInUserId,
  };

  const result = await executeStoredProcedure(
    "usp_GetEvaluatetionFormById",
    inputParams,
    outputmsgWithStatusCodeParams
  );
  return result;
}
