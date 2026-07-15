import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { setMappedFormWithInteraction } from "@/lib/models/interactionWithMappedForm";
import { isInvalid } from "@/lib/generic";

export const dynamic = "force-dynamic";

// The API endpoint to fetch interactions using GET
export async function GET(request, { params }) {
  try {
    const { id: interactionId } = await params;
    const loggedInUserId = request.headers.get("loggedInUserId");

    // Validate headers and parameters
    if (isInvalid(loggedInUserId) || isInvalid(interactionId)) {
      return NextResponse.json(
        { message: "Headers or Parameter are missing, undefined, or empty." },
        { status: 400 }
      );
    }

    // Call stored procedure to get the mapped form
    const result = await getMappedFormByInteractionId(
      interactionId,
      loggedInUserId
    );

    // Check if the stored procedure call returns expected result
    if (result?.recordset?.length > 0) {
      const mappedForm = await setMappedFormWithInteraction(
        result.recordsets[0]
      );

      // Return success response
      return NextResponse.json(
        {
          message: result.output?.outputmsg || "Form fetched successfully.",
          mappedForm,
        }
        //{ status: result.output?.statuscode || 200 }
      );
    } else {
      return NextResponse.json(
        { message: result.output?.outputmsg || "No records found." }
        //{ status: result.output?.statuscode || 404 }
      );
    }
  } catch (error) {
    // Improved logging for debugging
    console.error("Error occurred in GET /api/interactions/mappedform:", error);

    // Return a generic error response
    return NextResponse.json(
      { message: "An internal error occurred. Please try again later." },
      { status: 500 }
    );
  }
}

// Helper function to execute stored procedure and fetch data
async function getMappedFormByInteractionId(id, loggedInUserId) {
  const inputParams = {
    interactionId: id,
    userId: loggedInUserId,
  };

  // Call the stored procedure
  const result = await executeStoredProcedure(
    "usp_GetSubmittedFormByInteractionId",
    inputParams,
    outputmsgWithStatusCodeParams
  );

  return result;
}
