import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import { 
    executeStoredProcedure, 
    outputmsgWithStatusCodeParams 
} from "@/lib/sql.js";

export async function GET(request){
    try{
        const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);
   
        if (isInvalid(loggedInUserId)) {
          return NextResponse.json(
            { message: "LoggedInUserId header is missing, undefined, or invalid." },
            { status: 400 }
          );  
        }
        const result = await getUserAccess(loggedInUserId);

        if(result?.recordsets?.length > 0){
            const chartData = result.recordsets[0];
            
            return NextResponse.json(
                {
                    message: result.output.outputmsg,
                    data: chartData,
                },
                { status: result.output.statusCode }
            );
        }
        return NextResponse.json(
            { message: result.output.outputmsg },
            { status: result.output.statuscode }
        );
    }catch(error){
        return NextResponse.json(
            { message: error.message }, 
            { status: 500 }
        );
    }
}

async function getUserAccess(currentUserId){
    const inputParams= {
        currentUserId,
    };
    try{
        const result = await executeStoredProcedure(
            "usp_GetRoleModulePrivilegeAccess",
            inputParams,
            outputmsgWithStatusCodeParams
        );
        return result;
    }catch(error){
        console.error("Error executing stored procedure:", error);
        throw new Error("Failed to retrieve user status chart data from the database.");
    }
}
