import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
// import { setSubmittedFormWithInteraction } from "@/lib/models/submittedForm";
import { isInvalid } from "@/lib/generic";

export const dynamic = "force-dynamic";
export async function GET(request, { params }) {
  try {
    const UniqueId = params.id;
    const loggedInUserId = request.headers.get("loggedInUserId");
    const interactionId = request.headers.get("interactionId");

    if (
      isInvalid(loggedInUserId) ||
      isInvalid(interactionId) ||
      //isInvalid(formId) ||
      isInvalid(UniqueId)
    ) {
      return NextResponse.json(
        { message: "Missing or invalid parameters." },
        { status: 400 }
      );
    }

    // Fetch the mapped form using interactionId, userId, formId, and uniqueId
    const result = await getSubmittedFormByInteractionId(
      interactionId,
      //formId,
      UniqueId,
      loggedInUserId
    );

    if (result.recordset.length > 0) {
      // Create an array of results to return
      const formattedResults = result.recordset.map((item) => ({
        id: item.id,
        interactionId: item.interaction_id,
        formId: item.Form_id,
        formName: item.form_name,
        formDescription: item.form_description,
        ansFormJson: JSON.parse(item.Ansform_json), // Assuming this is a JSON string
      }));

      return NextResponse.json(
        {
          message: "Forms retrieved successfully.",
          data: formattedResults,
        },
        { status: 200 }
      );
    } else {
      return NextResponse.json({ message: "No forms found." }, { status: 404 });
    }
  } catch (error) {
    return NextResponse.json(
      { message: `Server error: ${error.message}` },
      { status: 500 }
    );
  }
}

// Function to fetch the mapped form using query parameters
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

  // Execute the stored procedure with the provided parameters
  const result = await executeStoredProcedure(
    "usp_GetEvaluatetionFormById",
    inputParams,
    outputmsgWithStatusCodeParams
  );
  return result;
}
