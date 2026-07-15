import { isInvalid } from "@/lib/generic";
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export async function GET(request, { params }) {
  // Destructure params from context
  try {
    const { id: interactionId } = await params;

    if (isInvalid(interactionId)) {
      return NextResponse.json(
        { message: "Headers or Parameter are missing or undefined or empty." },
        { status: 400 }
      );
    }

    const result = await getInteractionById(interactionId);

    if (result.recordsets.length > 0 && result.recordset) {
      const interactions = result.recordsets[0];

      return NextResponse.json(
        {
          message: result.output.outputmsg,
          interactions,
        },
        { status: result.output.statuscode }
      );
    } else {
      return NextResponse.json(
        { message: result.output.outputmsg },
        { status: result.output.statuscode }
      );
    }
  } catch (error) {
    console.error("Error in GET request:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

async function getInteractionById(id) {
  const inputParams = { interactionId: id };

  const result = await executeStoredProcedure(
    "usp_GetInteraction",
    inputParams
  );

  return result;
}
