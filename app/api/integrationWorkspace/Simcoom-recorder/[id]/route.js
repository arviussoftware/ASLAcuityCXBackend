import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

function requireBearerToken(request) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer")) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 },
      ),
    };
  }
  const token = authHeader.split(" ")[1];
  if (token !== API_SECRET_TOKEN) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 },
      ),
    };
  }
  return { ok: true };
}

// GET /api/integrationWorkspace/Simcoom-recorder/:id
export async function GET(request, { params }) {
  try {
    const auth = requireBearerToken(request);
    if (!auth.ok) return auth.response;

    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { success: false, message: "appid is required" },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure("usp_GetSimcoomRecorderConfigurationById", {
      appid: parseInt(id),
    });

    if (result.recordset && result.recordset.length > 0) {
      return NextResponse.json({
        success: true,
        message: "Simcomm Recorder configuration fetched successfully",
        data: result.recordset[0],
      });
    }

    return NextResponse.json(
      { success: false, message: "No record found" },
      { status: 404 },
    );
  } catch (error) {
    console.error("[Simcoom-recorder GET by id] error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT /api/integrationWorkspace/Simcoom-recorder/:id
// body: { baseUrl, instanceName, UpdatedBy, pairingMode? }
export async function PUT(request, { params }) {
  try {
    const auth = requireBearerToken(request);
    if (!auth.ok) return auth.response;

    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { success: false, message: "appid is required" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const pairingMode = Boolean(body?.EnablePairingMode ?? body?.enablePairingMode ?? body?.pairingMode ?? false);
    const paramsSp = {
      appid: parseInt(id) || 0,
      instanceName: body?.instanceName || body?.instance || "",
      baseUrl: body?.baseUrl || "",
      UpdatedBy: parseInt(body?.Modifieddby ?? body?.UpdatedBy) || 0,
      EnablePairingMode: pairingMode ? 1 : 0,
    };

    const result = await executeStoredProcedure(
      "usp_UpdateSimcoomRecorderConfiguration",
      paramsSp,
      [{ name: "outputmsg" }, { name: "statuscode" }],
    );

    const spStatus = Number(result?.output?.statuscode);
    const spMessage = result?.output?.outputmsg || null;

    if (Number.isFinite(spStatus) && spStatus !== 200) {
      return NextResponse.json(
        { success: false, message: spMessage || "Update failed" },
        { status: spStatus },
      );
    }

    return NextResponse.json({
      success: true,
      message: spMessage || "Simcomm Recorder configuration updated successfully",
      data: result.recordset || [],
    });
  } catch (error) {
    console.error("[Simcoom-recorder PUT] error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
