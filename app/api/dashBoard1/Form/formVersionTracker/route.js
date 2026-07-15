
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
    executeStoredProcedure,
    outputmsgWithStatusCodeParams,
}from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request){
    try{
        const loggedInUserId = parseInt(request.headers.get("loggedInUserId"))
        if(isInvalid(loggedInUserId)){
            return NextResponse.json(
                { message: "loggedInUserId header is missing or invalid." },
                { status: 400 }
            );
        }
        const result = await executeStoredProcedure(
            "usp_FormVersionTracker",
            {
              currentUserId: loggedInUserId,
            },
            outputmsgWithStatusCodeParams
          );

          const versionData = result?.recordsets?.[0] ?? [];
          return NextResponse.json(
            {
              message: result.output.outputmsg,
              data: versionData,
            },
            { status: result.output.statuscode }
          );
       }catch(error){
        console.error("🔥 Error fetching version tracker data:", error);
        return NextResponse.json(
            { message: "Internal Server Error", error: error.message },
            { status: 500 }
        );
    }
}