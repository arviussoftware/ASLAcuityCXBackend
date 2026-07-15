//app/api/reports/orgAgentDetails/[agentId]/route.js
import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { agentId } = params; // Extract agentId from the dynamic route

  // Parse query parameters for filtering (DateFilter, StartDate, EndDate)
  const url = new URL(request.url);
  const DateFilter = url.searchParams.get("DateFilter") || "Today";
  const StartDate = url.searchParams.get("StartDate");
  const EndDate = url.searchParams.get("EndDate");

  // Validate input parameters
  if (!agentId) {
    return NextResponse.json(
      { message: "Agent ID is required." },
      { status: 200 }
    );
  }

  if (DateFilter === "Custom" && (!StartDate || !EndDate)) {
    return NextResponse.json(
      {
        message:
          "StartDate and EndDate must be provided for the Custom filter.",
      },
      { status: 200 }
    );
  }

  try {
    // Prepare output parameters for the stored procedure
    const outputParameters = outputmsgWithStatusCodeParams;

    // Execute the stored procedure
    const result = await executeStoredProcedure(
      "usp_GetAgentOrgReportWithDate", // Stored procedure name
      {
        agent_id: agentId,
        DateFilter,
        StartDate,
        EndDate,
      },
      outputParameters // Output parameters (message and status code)
    );

    // Extract output values and result sets
    const outputmsg = result.output.outputmsg;
    const statuscode = parseInt(result.output.statuscode);

    if (statuscode === 200) {
      const agentReport = result.recordsets[0] || []; // Main report
      const formAssignments = result.recordsets[1] || []; // Form assignments

      if (agentReport.length === 0 && formAssignments.length === 0) {
        return NextResponse.json(
          {
            message: `No data found for this agent.`,
            agentReport: [],
            formAssignments: [],
            status: false,
          },
          { status: 200 }
        );
      }

      return NextResponse.json(
        {
          message: `Data fetched successfully.`,
          agentReport,
          formAssignments,
          status: false,
        },
        { status: 200 }
      );
    } else if (statuscode === 404) {
      return NextResponse.json(
        {
          message: `No data found for this agent.`,
          status: false,
        },
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        {
          message: `Unexpected error occurred. ${outputmsg}`,
          status: false,
        },
        { status: statuscode }
      );
    }
  } catch (error) {
    console.error("Error executing stored procedure:", {
      agentId,
      DateFilter,
      StartDate,
      EndDate,
      error: error.message,
    });

    return NextResponse.json(
      {
        message: `An error occurred while fetching details for agent ID '${agentId}' and date range '${DateFilter}'. Please try again.`,
        error: error.message,
        status: false,
      },
      { status: 500 }
    );
  }
}
