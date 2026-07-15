 import { NextResponse } from 'next/server';
 import { isInvalid } from '@/lib/generic';  // Custom utility function
 import { executeStoredProcedure, outputmsgWithStatusCodeParams } from '@/lib/sql.js'; // Custom DB utility
 
 export async function GET(request) {
   try {
     // const body = await request.json();
     
     // Get logged-in user ID from the request headers
     const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);
 
     if (isInvalid(loggedInUserId)) {
       return NextResponse.json(
         { message: "LoggedInUserId header is missing, undefined, or invalid." },
         { status: 400 }
       );  
       
     }
 
     // Fetch dashboard summary for the logged-in user
     const dashboardSummary = await getUserDashboardSummary(loggedInUserId);
 
     if (dashboardSummary?.recordsets?.length > 0) {
       const summary = dashboardSummary.recordsets[0][0]; // The result has a single row summary
 
       return NextResponse.json(
         {
           message: dashboardSummary.output.outputmsg,
           data: summary,
         },
         { status: dashboardSummary.output.statuscode }
       );
     }
 
     return NextResponse.json(
       { message: dashboardSummary.output.outputmsg },
       { status: dashboardSummary.output.statuscode }
     );
   } catch (error) {
     return NextResponse.json({ message: error.message }, { status: 500 });
   }
 }

async function  getUserDashboardSummary(currentUserId){
    const inputParams = {
        currentUserId,
    };

    try{
        const result = await executeStoredProcedure(
            "usp_GetDashboardSummaryMetrics",
            inputParams,
            outputmsgWithStatusCodeParams
        );
        return result;
    }catch(error){
        console.error("Error executing stored procedure:", error);
        throw new Error("Failed to retrieve form dashboard summary from the database.");
    }
}