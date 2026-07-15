//app/api/reports/orgAgentReport/route.js
import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js"; // import the correct output params

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    // Prepare the output parameters
    const outputParameters = outputmsgWithStatusCodeParams;

    // Execute the stored procedure
    const result = await executeStoredProcedure(
      "usp_GetAllOrganizationAgentReport", // The stored procedure name
      {}, // No input parameters needed for this procedure
      outputParameters // Output parameters for capturing message and status code
    );

    // Extract the output parameters from the result
    const outputmsg = result.output.outputmsg; // The message from the stored procedure
    const statuscode = parseInt(result.output.statuscode); // Convert statuscode to integer

    // If the status code is 200, return the result data; otherwise, return the message
    if (statuscode === 200) {
      const reportData = result.recordset; // Data from the report query (the organizations and agent count)

      return NextResponse.json(
        { message: outputmsg, reportData: reportData || [] }, // Return an empty array if no data is found
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        { message: outputmsg }, // Return just the message if the status code is not 200
        { status: statuscode }
      );
    }
  } catch (error) {
    console.error("Error executing the stored procedure:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
