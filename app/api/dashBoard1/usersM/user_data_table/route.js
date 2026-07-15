import { NextResponse } from 'next/server';
import { isInvalid } from '@/lib/generic';  // Your custom validation utility
import { executeStoredProcedure, outputmsgWithStatusCodeParams } from '@/lib/sql.js'; // Your DB helper
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    // Get logged-in user ID from headers (parse to int)
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "LoggedInUserId header is missing, undefined, or invalid." },
        { status: 400 }
      );
    }

    // Call your stored procedure
    const dashboardDetails = await getDashboardDetailsData(loggedInUserId);

    if (dashboardDetails?.recordsets?.length > 0) {
      // Stored procedure returns multiple result sets (multiple selects)
      // So, return them all in the response

      return NextResponse.json(
        {
          message: dashboardDetails.output.outputmsg,
          data: {
            allUsers: dashboardDetails.recordsets[0],       // First SELECT: All users
            activeUsers: dashboardDetails.recordsets[1],    // Second SELECT: Active users
            inactiveUsers: dashboardDetails.recordsets[2],  // Third SELECT: Inactive users
            roleSummary: dashboardDetails.recordsets[3],    // Fourth SELECT: Role summary
            orgSummary: dashboardDetails.recordsets[4],     // Fifth SELECT: Organizations summary
          },
        },
        { status: dashboardDetails.output.statuscode }
      );
    }

    return NextResponse.json(
      { message: dashboardDetails.output.outputmsg },
      { status: dashboardDetails.output.statuscode }
    );
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

// Function to call the stored procedure
async function getDashboardDetailsData(currentUserId) {
  const inputParams = {
    currentUserId,
  };

  try {
    const result = await executeStoredProcedure(
      "usp_GetDashboardDetailsData",
      inputParams,
      outputmsgWithStatusCodeParams
    );
    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error("Failed to retrieve dashboard details data from the database.");
  }
}
