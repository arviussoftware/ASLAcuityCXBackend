import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { interactionId, formId, currentUserId, uniqueId } =
      await request.json();

    // Check if any of the required fields are undefined
    if (
      isInvalid(interactionId) ||
      isInvalid(formId) ||
      isInvalid(currentUserId) ||
      isInvalid(uniqueId)
    ) {
      return NextResponse.json(
        { message: "Some properties are undefined or empty." },
        { status: 400 }
      );
    }

    const result = await insertInteractionFormMapping(
      interactionId,
      formId,
      currentUserId,
      uniqueId
    );

    if (parseInt(result.output.statuscode) === 200) {
      return NextResponse.json(
        { message: result.output.outputmsg },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        { message: result.output.outputmsg },
        { status: result.output.statuscode }
      );
    }
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { message: "Internal server error ||" + error.message },
      { status: 500 }
    );
  }
}

async function insertInteractionFormMapping(
  interactionId,
  formId,
  currentUserId,
  uniqueId
) {
  const inputParams = {
    interactionId: interactionId,
    formId: formId,
    currentUserId: currentUserId,
    uniqueId: uniqueId,
  };

  const result = await executeStoredProcedure(
    "usp_FormAssignationWithInteraction",
    inputParams,
    outputmsgWithStatusCodeParams
  );
  return result;
}
