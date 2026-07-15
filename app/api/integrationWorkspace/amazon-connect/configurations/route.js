import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 },
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 },
      );
    }

    const loggedInUserId = request.headers.get("loggedInUserId");
    const { searchParams } = new URL(request.url);
    const platformid = searchParams.get("platformid") || "4";
    const currentUserId = searchParams.get("currentUserId");
    const resolvedUserId = Number(currentUserId || loggedInUserId || 1);

    const tryExecute = async (params) =>
      executeStoredProcedure("usp_GetAmazonConnectConfigurations", params);

    let result;
    try {
      result = await tryExecute({
        currentUserId: resolvedUserId,
        PlatformId: Number(platformid) || 4,
      });
    } catch (err) {
      const msg = String(err?.message || "");
      const fallbackNeeded =
        msg.includes("expects parameter") ||
        msg.includes("expects the parameter") ||
        msg.includes("too many arguments") ||
        msg.includes("Too many arguments");
      if (!fallbackNeeded) throw err;
      result = await tryExecute({
        currentUserId: resolvedUserId,
        platformid: String(platformid),
      });
    }

    const rows =
      result?.recordset ||
      (Array.isArray(result?.recordsets) && result.recordsets.length > 0
        ? result.recordsets[result.recordsets.length - 1]
        : []);
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error("Error while fetching Amazon Connect configurations:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch configurations." },
      { status: 500 },
    );
  }
}

