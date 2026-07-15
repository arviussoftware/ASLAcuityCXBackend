import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const url = new URL(request.url);

    // Extract query params
    const filterType = url.searchParams.get("filterType") || "last7days"; // Default to 'last7days'
    const timezone = url.searchParams.get("timezone") || null; // Optional timezone
    const currentUserId = parseInt(request.headers.get("loggedInUserId"));

    // Validate currentUserId
    if (isInvalid(currentUserId)) {
      return NextResponse.json(
        { message: "Invalid or missing loggedInUserId" },
        { status: 400 }
      );
    }

    // Call the stored procedure
    const result = await executeStoredProcedure(
      "usp_FormActionCenter",
      {
        filterType,
        currentUserId,
        timezone,
      },
      outputmsgWithStatusCodeParams
    );

    // Check if the result contains recordsets
    const forms = result?.recordsets?.[0] ?? [];

    // Check if there are no forms in the response
    if (forms.length === 0) {
      return NextResponse.json(
        {
          message: "No forms found for the given filter type",
          data: [],
        },
        { status: 200 }
      );
    }

    // Return successful response
    return NextResponse.json(
      {
        message: result.output.outputmsg || "Data fetched successfully",
        data: forms,
      },
      { status: result.output.statuscode }
    );
  } catch (error) {
    console.error("Error in usp_FormActionCenter API:", error);
    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 }
    );
  }
}
