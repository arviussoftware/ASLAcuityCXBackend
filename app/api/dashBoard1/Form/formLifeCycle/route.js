import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    // Extract loggedInUserId from request headers
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"));

    // Validate the userId
    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "Missing or invalid loggedInUserId" },
        { status: 400 }
      );
    }

    const timezone = request.headers.get("timezone"); // ✅ Needed now

    // Execute the stored procedure to get form lifecycle details
    const result = await executeStoredProcedure(
      "usp_FormLifecycleDetails", // Stored procedure name
      { currentUserId: loggedInUserId, timezone }, // Stored procedure parameters
      outputmsgWithStatusCodeParams // Output message and status code parameters
    );

    // Get the form lifecycle details
    const formLifecycleDetails = result?.recordsets?.[0] ?? [];

    // Return a JSON response with the result
    return NextResponse.json(
      {
        message: result.output.outputmsg,
        data: formLifecycleDetails,
      },
      { status: result.output.statuscode }
    );
  } catch (error) {
    // Log error and return internal server error response
    console.error("Error in Form Lifecycle Details API:", error);
    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 }
    );
  }
}
