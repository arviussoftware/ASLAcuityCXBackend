import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js"; // Adjust the path as needed for your project setup

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = params; // Extract organization ID from the dynamic route

  if (!id) {
    console.error("Missing organization ID in the request");
    return NextResponse.json(
      { message: "Organization ID is required." },
      { status: 200 }
    );
  }

  try {
    // Parse the organization ID to ensure it's a valid integer
    const organizationId = parseInt(id);

    if (isNaN(organizationId)) {
      console.error("Invalid Organization ID:", id);
      return NextResponse.json(
        {
          message: `Invalid Organization ID: '${id}'. Please provide a numeric value.`,
        },
        { status: 200 }
      );
    }

    // Prepare output parameters for the stored procedure
    const outputParameters = outputmsgWithStatusCodeParams;

    // Execute the stored procedure with the organization ID
    const result = await executeStoredProcedure(
      "usp_GetSingleOrganizationAgentReport", // Stored procedure name
      {
        organizationId, // Organization ID as input
      },
      outputParameters // Output parameters
    );

    // Extract output parameters
    const outputmsg = result.output.outputmsg;
    const statuscode = parseInt(result.output.statuscode);

    // Return the appropriate response based on the status code
    if (statuscode === 200) {
      const agents = result.recordset || []; // Extract the mapped agent login IDs
      return NextResponse.json({ agents }, { status: 200 });
    } else if (statuscode === 404) {
      console.warn(`No agents found for this Organization`);
      return NextResponse.json(
        {
          message: `No agents found for organization`,
        },
        { status: 200 }
      );
    } else {
      console.error(
        `Unexpected status code ${statuscode}. Message: ${outputmsg}`
      );
      return NextResponse.json(
        {
          message: `Unexpected error occurred. ${outputmsg}`,
        },
        { status: statuscode }
      );
    }
  } catch (error) {
    console.error("Error executing the stored procedure:", {
      message: error.message,
      stack: error.stack,
    });
    return NextResponse.json(
      { message: "An error occurred while fetching the agent report." },
      { status: 500 }
    );
  }
}
