import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

function requireBearerToken(request) {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer")) {
    return { ok: false, response: NextResponse.json({ success: false, message: "Unauthorized: Token missing" }, { status: 401 }) };
  }
  const token = authHeader.split(" ")[1];
  if (token !== API_SECRET_TOKEN) {
    return { ok: false, response: NextResponse.json({ success: false, message: "Unauthorized: Invalid token" }, { status: 401 }) };
  }
  return { ok: true };
}

// GET /api/integrationWorkspace/Simcoom-recorder?platformId=14
export async function GET(request) {
  try {
    const auth = requireBearerToken(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const platformIdParam = searchParams.get("platformId") || searchParams.get("platformid");
    const platformId = platformIdParam ? Number(platformIdParam) : 14;

    const result = await executeStoredProcedure("usp_GetSimcoomRecorderConfigurations", {
      PlatformId: Number.isFinite(platformId) ? platformId : 14,
    });

    const rows = Array.isArray(result?.recordset) ? result.recordset : [];
    const pickCI = (obj, ...keys) => {
      if (!obj) return null;
      for (const key of keys) {
        const direct = obj?.[key];
        if (direct !== undefined && direct !== null && direct !== "") return direct;
        const target = String(key).toLowerCase();
        for (const [k, v] of Object.entries(obj)) {
          if (String(k).toLowerCase() === target && v !== undefined && v !== null && v !== "") {
            return v;
          }
        }
      }
      return null;
    };

    const data = rows.map((r) => ({
      appid: pickCI(r, "appid", "AppId", "Id", "id"),
      instanceName: pickCI(r, "instanceName", "InstanceName", "instance", "Instance"),
      baseUrl: pickCI(r, "baseUrl", "BaseUrl", "base_url", "baseurl", "URL", "url"),
      pairingMode: Boolean(
        Number(
          pickCI(
            r,
            "EnablePairingMode",
            "enablePairingMode",
            "pairingMode",
            "PairingMode",
          ) ?? 0,
        ),
      ),
      createdDate:
        pickCI(
          r,
          "createdDate",
          "CreatedDate",
          "createdOn",
          "CreatedOn",
          "created_at",
          "CreatedAt",
          "createddate",
        ) || null,
    }));

    return NextResponse.json({
      success: true,
      message: "Simcomm Recorder configurations fetched successfully",
      data,
    });
  } catch (error) {
    console.error("[Simcoom-recorder GET] error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST /api/integrationWorkspace/Simcoom-recorder
// body: { PlatformId?:14, baseUrl, instanceName, Createdby, Organization }
export async function POST(request) {
  try {
    const auth = requireBearerToken(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const platformId = Number(body?.PlatformId ?? body?.platformId ?? 14);
    const pairingMode = Boolean(body?.EnablePairingMode ?? body?.enablePairingMode ?? body?.pairingMode ?? false);

    const params = {
      PlatformId: Number.isFinite(platformId) ? platformId : 14,
      baseUrl: body?.baseUrl || "",
      instanceName: body?.instanceName || body?.instance || "",
      Createdby: parseInt(body?.Createdby) || 0,
      Organization: parseInt(body?.Organization) || 0,
      EnablePairingMode: pairingMode ? 1 : 0,
    };

    const result = await executeStoredProcedure(
      "usp_SaveSimcoomRecorderConfiguration",
      params,
      [{ name: "outputmsg" }, { name: "statuscode" }, { name: "appid" }],
    );

    const spStatus = Number(result?.output?.statuscode);
    const spMessage = result?.output?.outputmsg || null;

    if (Number.isFinite(spStatus) && spStatus !== 200) {
      return NextResponse.json(
        { success: false, message: spMessage || "Save failed" },
        { status: spStatus },
      );
    }
    const appId = result?.recordset?.[0]?.AppId || null;

    return NextResponse.json({
      success: true,
      message: spMessage || "Simcomm Recorder configuration saved successfully",
      appId,
      data: result.recordset || [],
    });
  } catch (error) {
    console.error("[Simcoom-recorder POST] error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
