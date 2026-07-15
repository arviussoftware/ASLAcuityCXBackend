import { NextResponse } from "next/server";

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

function validateHttpUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, reason: "URL is required" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http/https URLs are allowed" };
  }
  return { ok: true, url };
}

async function tryFetch(url, opts) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal, cache: "no-store" });
    return { ok: true, status: res.status };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
// GET /api/integrationWorkspace/Simcoom-recorder/ping?url=https://host
export async function GET(request) {
  try {
    const auth = requireBearerToken(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get("url") || "";

    const validated = validateHttpUrl(rawUrl);
    if (!validated.ok) {
      return NextResponse.json(
        { success: true, data: { status: "invalid", reason: validated.reason } },
        { status: 200 },
      );
    }

    const url = validated.url.toString();

    // HEAD first (fast), then GET as fallback (some servers block HEAD)
    try {
      const head = await tryFetch(url, { method: "HEAD", redirect: "follow" });
      const isOnline = head.ok && head.status >= 200 && head.status < 500;
      return NextResponse.json({
        success: true,
        data: { status: isOnline ? "online" : "offline", httpStatus: head.status },
      });
    } catch (e) {
      // ignore and try GET fallback
      console.error("[Simcoom-recorder ping] HEAD failed:", e?.message || e);
    }

    try {
      const get = await tryFetch(url, { method: "GET", redirect: "follow" });
      const isOnline = get.ok && get.status >= 200 && get.status < 500;
      return NextResponse.json({
        success: true,
        data: { status: isOnline ? "online" : "offline", httpStatus: get.status },
      });
    } catch (e) {
      return NextResponse.json({
        success: true,
        data: { status: "offline", reason: e?.name === "AbortError" ? "timeout" : "fetch_failed" },
      });
    }
  } catch (error) {
    console.error("[Simcoom-recorder ping] error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
