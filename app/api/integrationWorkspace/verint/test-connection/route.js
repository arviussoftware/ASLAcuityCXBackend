import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

function normalizeUrl(hostName) {
  if (!hostName) return "";
  const trimmed = String(hostName).trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `http://${trimmed}`;
}

function buildVerintAuthUrl(hostName) {
  const base = normalizeUrl(hostName).replace(/\/+$/, "");
  return `${base}/wfo/rest/core-api/auth/token`;
}

export async function POST(request) {
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

    const body = await request.json();
    const { hostName, vcApiUserId, apiPassword, authorizationHeader } = body || {};

    const testUrl = buildVerintAuthUrl(hostName);
    if (!testUrl) {
      return NextResponse.json(
        { success: false, message: "Host Name is required." },
        { status: 400 },
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (authorizationHeader) {
        headers.Authorization = authorizationHeader;
      }

      const response = await fetch(testUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          user: vcApiUserId || "",
          password: apiPassword || "",
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeoutId);

      const setCookie = response.headers.get("set-cookie");
      const responseText = await response.text();
      if (!response.ok) {
        return NextResponse.json(
          {
            success: false,
            message: `Verint auth failed with status ${response.status}.`,
            data: {
              status: response.status,
              url: testUrl,
              response: responseText,
            },
          },
          { status: response.status },
        );
      }

      return NextResponse.json({
        success: true,
        message: `Connection test passed. Verint auth token endpoint responded with status ${response.status}.`,
        data: {
          status: response.status,
          url: testUrl,
          hasCookie: Boolean(setCookie),
          response: responseText,
        },
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      return NextResponse.json(
        {
          success: false,
          message:
            fetchError?.name === "AbortError"
              ? "Connection timeout while reaching host."
              : `Unable to reach host: ${fetchError.message}`,
          data: { url: testUrl },
        },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error("Error while testing Verint connection:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to test connection." },
      { status: 500 },
    );
  }
}
