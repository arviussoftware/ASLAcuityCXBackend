import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
} from "@/lib/sql.js";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

// ✅ ================== GET API ==================
export async function GET(request, { params }) {
  try {
    const authHeader = request.headers.get("authorization");
      const { searchParams } = new URL(request.url);
      
    const instanceId = params.instanceId;
    const adapterType = searchParams.get("adapterType");

    // 🔐 Token check
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 }
      );
    }

    // ❌ Validation
    if (!instanceId || !adapterType) {
      return NextResponse.json(
        {
          success: false,
          message: "instanceId and adapterType are required",
        },
        { status: 400 }
      );
    }

    // 📦 DB call
    const result = await getCiscoApiConfig(instanceId , adapterType);

    const recordset = result?.recordsets?.[0];

    // ❌ No data
    if (!recordset || recordset.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: result?.output?.outputmsg || "No data found",
          data: [],
        },
        { status: 404 }
      );
    }

    // ✅ Format data
    const formattedData = formatCiscoApiConfig(recordset);

    // ✅ Final response
    return NextResponse.json(
      {
        success: true,
        message: "Cisco API config fetched successfully",
        data: formattedData,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET Cisco API Error:", error);

    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}

// ✅ ================== DB FUNCTION ==================
async function getCiscoApiConfig(instanceId , adapterType) {
  try {
    const inputParams = {
      instanceId: instanceId,
       adapterType: adapterType,
    };

    const result = await executeStoredProcedure(
      "usp_GetCiscoApiConfig", // 👉 apna stored procedure name
      inputParams
    );

    return result;
  } catch (error) {
    console.error("Stored Procedure Error:", error);
    throw error;
  }
}

// ✅ ================== FORMAT FUNCTION ==================
function formatCiscoApiConfig(recordset) {
  return recordset.map((item) => ({
    id: item.id,
    tenantId: item.tenant_id,
    instanceId: item.instance_id,
    apiName: item.api_name,
    apiUrl: item.apiurl,
    parameters: item.parameters,
    retryAttempt: item.retry_attempt,
    defaultPageSize: item.defaultpagesize,
    apiCode: item.api_code,
    pgFunctionName: item.pg_function_name,
    apiType: item.api_type,
    apiVersion: item.api_version,
    httpVerb: item.httpverb,
    intervalMinutes: item.intervalminutes,
    intervalSplitMinutes: item.intervalsplitminutes,
    lastFetchedUnix: item.lastfetched_unixepochtime,
    fromTime: item.fromtimehumanreadable,
    toTime: item.totimehumanreadable,
    jobType: item.jobtype,
  }));
}