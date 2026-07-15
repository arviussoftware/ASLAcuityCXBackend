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
    const result = await getTenantDetails(instanceId, adapterType);

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
    const formattedData = formatTenantDetails(recordset[0]);

    return NextResponse.json(
      {
        success: true,
        message: "Tenant details fetched successfully",
        data: formattedData,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET Tenant Details Error:", error);

    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}

// ✅ ================== DB FUNCTION ==================
async function getTenantDetails(instanceId, adapterType) {
  try {
    const inputParams = {
      instanceId: instanceId,
      adapterType: adapterType,
    };

    const result = await executeStoredProcedure(
      "usp_get_tenant_config", // 👉 given function/SP name
      inputParams
    );

    return result;
  } catch (error) {
    console.error("Stored Procedure Error:", error);
    throw error;
  }
}

// ✅ ================== FORMAT FUNCTION ==================
function formatTenantDetails(item) {
  return {
    tenant_id: item.tenant_id,
    tenant_code: item.tenant_code,
    org_name: item.org_name,
    org_id: item.org_id,
    auth_url: item.auth_url,
    client_id: item.client_id,
    client_secret: item.client_secret,
    base_url: item.base_url,
    redirect_url: item.redirect_url,
    token: item.token,
    token_expires_inseconds: item.token_expires_inseconds,
    refresh_token: item.refresh_token,
    timezone: item.timezone,
    is_tokenexpired: item.is_tokenexpired,
    refresh_token_expires_in: item.refresh_token_expires_in,
    token_type: item.token_type,
    token_expires_date: item.token_expires_date,
  };
}