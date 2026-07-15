import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgParams,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import FormsModel from "@/lib/models/forms";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { getAuditUser, logAudit } from "@/lib/auditLogger";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request, { params }) {
  try {
    const authHeader = request.headers.get("authorization");

    // 🔐 Step 2: Check if token is missing or incorrect
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
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
    // const hasAddPermission = await checkUserPrivilege(
    //   currentUserId,
    //   MODULES.FORM_DESIGNER, // → this will be 2
    //   PRIVILEGES.CREATEEDITFORM // → this will be 2
    // );

    // if (!hasAddPermission) {
    //   return NextResponse.json(
    //     {
    //       success: false,
    //       message: "Unauthorized: You do not have permission to Save Form.",
    //     },
    //     { status: 403 }
    //   );
    // }
    const uniqueid = params.id;

    if (!uniqueid || typeof uniqueid !== "string") {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid uniqueid provided to fetch the user record.",
        },
        { status: 400 },
      );
    }
    const FormData = await getFormById(uniqueid);
    if (FormData.recordset.length > 0) {
      const forms = await setFormsModel(FormData.recordset);
      return NextResponse.json(
        { success: true, message: "Record found", forms },
        { status: 200 },
      );
    } else {
      return NextResponse.json(
        { message: "Record Not found" },
        { status: 404 },
      );
    }
  } catch (error) {
    console.error("Error in GET request:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

async function getFormById(id) {
  try {
    const inputParams = {
      uniqueid: id,
    };
    const result = await executeStoredProcedure("usp_GetFormById", inputParams);
    return result;
  } catch (error) {
    console.error("Error fetching form by ID:", error);
    throw new Error("Error fetching form by ID");
  }
}

async function setFormsModel(recordset) {
  try {
    const forms = await recordset.map(
      (form) =>
        new FormsModel(
          form.Form_id,
          form.form_name,
          form.form_description,
          form.form_json,
          form.Status,
          form.Modify_date,
          form.UniqueId,
          form.Creation_by,
          form.Modify_by,
          form.Version,
          form.Passing_score,
          form.interactiontype,
          form.InteractionTypeName,
          form.Max_score,
        ),
    );
    return forms;
  } catch (error) {
    console.error("Error setting forms model:", error);
    throw new Error("Error setting forms model");
  }
}

export async function POST(request, { params }) {
  try {
    const FormId = params.id;

    if (!FormId || isNaN(FormId)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid FormID provided to fetch the user record.",
        },
        { status: 400 },
      );
    }

    const {
      formName,
      formDescription,
      sections,
      hideFormScore,
      basePercentage,
      scoringMethod,
      baselineScore,
      visibilityRules,
      scoringRules,
      disabledOptions,
      Status,
      currentUserId,
      maxScore,
      header,
      footer,
      auditAction,
      selectedInteractionTypes,
    } = await request.json();

    const isInvalid = (value) =>
      value === undefined || value === null || value === "";
    if (isInvalid(formName)) {
      return NextResponse.json(
        { success: false, message: "Form name is undefined or empty." },
        { status: 400 },
      );
    }

    if (isInvalid(sections)) {
      return NextResponse.json(
        { success: false, message: "Sections are undefined or empty." },
        { status: 400 },
      );
    }
    const formattedDisabledOptions = {
      first: Array.isArray(disabledOptions?.first) ? disabledOptions.first : [],
      second: Array.isArray(disabledOptions?.second)
        ? disabledOptions.second
        : [],
    };

    const formJson = JSON.stringify({
      sections,
      hideFormScore,
      basePercentage,
      scoringMethod,
      visibilityRules,
      scoringRules,
      disabledOptions: formattedDisabledOptions,
      header,
      footer,
    });

    // In POST handler - was passing selectedInteractionTypes but variable didn't exist
    const updateResult = await updateFormDetails(
      FormId,
      formName,
      formDescription,
      formJson,
      Status,
      currentUserId,
      maxScore,
      baselineScore,
      selectedInteractionTypes, // ✅ now correctly defined above
    );

    if (parseInt(updateResult.output.statuscode) === 200) {
      const auditUser = await getAuditUser(currentUserId);
      const actionType = auditAction || "FORM_PUBLISHED";
      const descriptionMap = {
        FORM_PUBLISHED: `Published form '${formName}'.`,
        FORM_UPDATED: `Updated form '${formName}'.`,
        FORM_DRAFT_UPDATED: `Updated draft form '${formName}'.`,
      };

      await logAudit({
        userId: auditUser.userId,
        userName: auditUser.userName,
        actionType,
        description:
          descriptionMap[actionType] || `Updated form '${formName}'.`,
      });

      return NextResponse.json(
        { success: true, message: updateResult.output.outputmsg },
        { status: updateResult.output.statuscode },
      );
    } else {
      // console.error("Update failed:", updateResult.output.outputmsg);
      return NextResponse.json(
        { success: false, message: updateResult.output.outputmsg },
        { status: updateResult.output.statuscode },
      );
    }
  } catch (error) {
    console.error("Error in POST request:", error);
    if (error instanceof RangeError) {
      return NextResponse.json(
        { success: false, message: error.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

async function updateFormDetails(
  id,
  formName,
  formDescription,
  formJson,
  Status,
  currentUserId,
  maxScore,
  baselineScore,
  selectedInteractionTypes,
) {
  try {
    // ✅ Convert array to comma-separated string for SQL
    // const interactionTypeValue =
    //   Array.isArray(selectedInteractionTypes) &&
    //   selectedInteractionTypes.length > 0
    //     ? selectedInteractionTypes.join(",")
    //     : null;
    const interactionTypeValue = (() => {
      if (
        Array.isArray(selectedInteractionTypes) &&
        selectedInteractionTypes.length > 0
      ) {
        return selectedInteractionTypes.join(",");
      }
      if (
        typeof selectedInteractionTypes === "string" &&
        selectedInteractionTypes.trim() !== ""
      ) {
        return selectedInteractionTypes; // already a string
      }
      return null;
    })();
    const inputParams = {
      formId: id,
      formName: formName,
      formDescription: formDescription,
      formJson: formJson,
      status: Status,
      currentUserId,
      maxScore,
      baselineScore:
        baselineScore === "" || baselineScore === null ? 0.0 : baselineScore,
      selectedInteractionType: interactionTypeValue,
    };

    const result = await executeStoredProcedure(
      "usp_UpdateForm",
      inputParams,
      outputmsgWithStatusCodeParams,
    );

    return result;
  } catch (error) {
    console.error("Error updating form details:", error);
    throw new Error("Error updating form details");
  }
}
// Trigger recompile

