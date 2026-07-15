import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");

    // 🔐 Auth check
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Invalid token" },
        { status: 401 }
      );
    }

    const body = await request.json();

    const {
      instanceId,
      tenantId,
      adapterType,
      access_token,
      expires_in,
      refresh_token,
      refresh_token_expires_in,
      token_type,
      scope,
    } = body;

    // ❌ validation
    if (!instanceId || !tenantId || !adapterType || !access_token) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 }
      );
    }

    const inputParams = {
      instanceId,
      tenantId,
      adapterType,
      access_token,
      expires_in,
      refresh_token,
      refresh_token_expires_in,
      token_type,
      scope,
    };

    const result = await executeStoredProcedure(
      "usp_update_tenant_access_token",
      inputParams
    );

    return NextResponse.json(
      {
        success: result?.recordset?.[0]?.success === 1,
        message: result?.recordset?.[0]?.message,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("Update Token API Error:", error);

    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}