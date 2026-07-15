import { executeStoredProcedure } from "@/lib/sql.js";
import FormAnswersModel from "@/lib/models/formAnswers";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { isInvalid } from "@/lib/generic";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");
    const orgIds = request.headers.get("orgIds") || request.headers.get("orgId");
    const { formId, startDate, endDate } = await request.json();
    if (!authHeader || !authHeader.startsWith("Bearer")) {
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

    // Validate required headers (interactionId removed)
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        {
          message:
            "Headers are missing or undefined or empty or can't pass wrong value.",
        },
        { status: 400 }
      );
    }
    const hasViewPermission = await checkUserPrivilege(
      loggedInUserId,
      MODULES.REPORTS,
      PRIVILEGES.VIEW,
      orgIds || null
    );
    if (!hasViewPermission) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: No permission to view report.",
        },
        { status: 403 }
      );
    }
    if (!formId || !startDate || !endDate) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Form ID, start date, and end date are required.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const formAnswersResult = await getFilteredFormAnswers(
      formId,
      startDate,
      endDate
    );

    if (
      !formAnswersResult.recordsets ||
      formAnswersResult.recordsets.length === 0
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "This form is not available on the current date.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const formAnswers = await setFormAnswersModel(
      formAnswersResult.recordsets[0]
    );

    if (typeof formAnswers === "string") {
      return new Response(
        JSON.stringify({
          success: false,
          message: formAnswers,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const formName =
      formAnswersResult.recordsets[0][0]?.FormName || "Unknown Form";

    return new Response(
      JSON.stringify({
        success: true,
        message: "Form answers fetched successfully.",
        formAnswers,
        formName,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("Error occurred while processing POST request:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Internal server error." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

async function getFilteredFormAnswers(formId, startDate, endDate) {
  try {
    const result = await executeStoredProcedure("usp_GetFormAnswersByDate", {
      formId,
      startDate,
      endDate,
    });
    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw error;
  }
}

async function setFormAnswersModel(recordset) {
  try {
    if (!recordset || recordset.length === 0) {
      return "This form is not available on the current date.";
    }

    const formAnswers = recordset.map(
      (record) =>
        new FormAnswersModel(
          record.interaction_id,
          record.FormId,
          record.assignation_date,
          record.assignation_by,
          record.SectionDetails,
          record.SubsectionDetails,
          record.Question,
          record.Answer,
          record.FinalScore
        )
    );
    return formAnswers;
  } catch (error) {
    console.error(
      "Error occurred while transforming form answers model:",
      error
    );
    throw new Error("Failed to transform form answers data.");
  }
}
