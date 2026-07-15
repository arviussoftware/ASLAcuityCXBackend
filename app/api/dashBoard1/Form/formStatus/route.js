
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import { executeStoredProcedure, outputmsgWithStatusCodeParams } from "@/lib/sql.js";
 
export const dynamic = "force-dynamic";

export async function GET(request){
    try{
        const loggedInUserId = parseInt(request.headers.get("loggedInUserId"),10);
        if(isInvalid(loggedInUserId)){
            return NextResponse.json(
                {message : "LoggedInUserId Header is missing or invalid" },
                {status : 400}
            );
        }

        const formStatus = await getFormStatus(loggedInUserId);

        if (formStatus?.recordsets?.length > 0) {
            // Process the status counts
            const statusCounts = formStatus.recordsets[0].reduce((acc, row) => {
                const { StatusName, StatusCount } = row;
                acc[StatusName] = StatusCount; // e.g., "Draft": 4
                return acc;
            }, {});
  
            return NextResponse.json(
                {
                    message: formStatus.output.outputmsg,
                    data: statusCounts, // Return the processed status count data
                },
                { status: formStatus.output.statuscode }
            );
        }
        return NextResponse.json(
            {message : formStatus.output.outputmsg},
            {status : formStatus.output.statuscode}
        );
    }catch(error){
        return NextResponse.json({message: error.message},{status:500});
    }
}

async function getFormStatus(currentUserId){
    const inputParams ={
        currentUserId,
    };
    try{
        const result = await executeStoredProcedure(
            "usp_FormStatusDistribution",
            inputParams,
            outputmsgWithStatusCodeParams
        );
        return result
    }catch(error){
        console.error("Error executing stored procedure:", error);
        throw new Error("Failed to retrieve form dashboard summary from the database.");
    }
}