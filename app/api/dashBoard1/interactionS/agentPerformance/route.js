import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
     executeStoredProcedure,
     outputmsgWithStatusCodeParams,
 } from "@/lib/sql.js";
 
 export const dynamic = "force-dynamic";
 
 export async function GET(request) {
     try {
        const url = new URL(request.url);
        const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);
        const timezone = request.headers.get("timezone");
        const filterType = url.searchParams.get("filterType") || "daily";
        const startDate = url.searchParams.get("startDate");
        const endDate = url.searchParams.get("endDate");
 
         // Validate required param
         if (isInvalid(loggedInUserId)) {
             return NextResponse.json(
                 { message: "loggedInUserId header is missing or invalid." },
                 { status: 400 }
             );
         }
 
         // Validate filterType
         const allowedFilterTypes = ["daily", "weekly", "monthly", "All"];
         if (!allowedFilterTypes.includes(filterType)) {
             return NextResponse.json(
                 { message: `Invalid filterType. Allowed: ${allowedFilterTypes.join(", ")}` },
                 { status: 400 }
             );
         }
 
         // Validate dates if filterType is 'custom'
         if (filterType === "All" && (!startDate || !endDate)) {
             return NextResponse.json(
                 { message: "startDate and endDate are required for 'custom' filterType." },
                 { status: 400 }
             );
         }
 
         const result = await getAgentPerformance({
             currentUserId: loggedInUserId,
             filterType,
             startDate: filterType === "All" ? startDate : null,
             endDate: filterType === "All" ? endDate : null,
             timezone,
         });
 
         const data = result?.recordsets?.[0] || [];
 
         return NextResponse.json(
             {
                 message: result.output.outputmsg || "No message returned",
                 data,
             },
             { status: result.output.statuscode || 200 }
         );
     } catch (error) {
         console.error("Agent Performance API Error:", error);
         return NextResponse.json(
             { message: "Internal Server Error", error: error.message },
             { status: 500 }
         );
     }
 }
 
 async function getAgentPerformance({ currentUserId, filterType, startDate, endDate ,timezone}) {
     const inputParams = {
        currentUserId,
        filterType,
        startDate,
        endDate,
        timezone: timezone,
     };
 
     return await executeStoredProcedure(
         "usp_AgentPerformanceOverTime",
         inputParams,
         outputmsgWithStatusCodeParams
     );
 }
 