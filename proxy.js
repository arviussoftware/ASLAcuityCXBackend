import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

export const config = {
  matcher: ["/api/:path*", "/dashboard/:path*"],
};

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/api/login",
  "/api/forgotPassword",
  "/api/resetPassword",
  "/api/generateForgotPasswordOtpByLoginId",
  "/api/generateForgotPasswordOtp",
  "/api/getEmailByLoginId",
  "/api/users/verify-otp",
  "/api/users/set-password",
  "/api/transcription-generate",
  "/api/dataencription",
];

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  ...(process.env.OAUTH_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

function applySecurityHeaders(response) {
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  response.headers.set("X-XSS-Protection", "1; mode=block");


  const cspValue =
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https:; " +
    "media-src 'self' blob: data: https:; " +
    "connect-src 'self' https:; " +
    "frame-ancestors 'self';";
  response.headers.set("Content-Security-Policy", cspValue);

  return response;
}

function applyCorsHeaders(req, response) {
  const origin = req.headers.get("origin");

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Vary", "Origin");
  }

  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    req.headers.get("access-control-request-headers") ||
      "Content-Type, Authorization, orgId, orgIds, loggedInUserId, userName",
  );

  return applySecurityHeaders(response);
}

function applyAllHeaders(req, response) {
  return applyCorsHeaders(req, response);
}

export async function proxy(req) {
  const { pathname } = req.nextUrl;

  if (req.method === "OPTIONS" && pathname.startsWith("/api")) {
    return applyAllHeaders(req, new NextResponse(null, { status: 204 }));
  }

  if (PUBLIC_PATHS.includes(pathname)) {
    return applyAllHeaders(req, NextResponse.next());
  }

  if (pathname.startsWith("/api") || pathname.startsWith("/dashboard")) {
    const authHeader = req.headers.get("authorization");
    const backendToken =
      process.env.API_SECRET_TOKEN || process.env.NEXT_PUBLIC_API_TOKEN;

    // 1. If Authorization header is provided, validate it against the API secret token
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const apiToken = authHeader.split(" ")[1];
      if (backendToken && apiToken === backendToken) {
        return applyAllHeaders(req, NextResponse.next());
      }
      return applyAllHeaders(
        req,
        NextResponse.json(
          { message: "Unauthorized: Invalid API Token" },
          { status: 401 },
        ),
      );
    }

    // 1.5. If auth query parameter is provided, validate it against the API secret token
    const authQuery = req.nextUrl.searchParams.get("auth");
    if (authQuery) {
      if (backendToken && authQuery === backendToken) {
        return applyAllHeaders(req, NextResponse.next());
      }
      return applyAllHeaders(
        req,
        NextResponse.json(
          { message: "Unauthorized: Invalid API Token via query" },
          { status: 401 },
        ),
      );
    }

    // 2. Otherwise, check for sessionToken cookie
    const token = req.cookies.get("sessionToken")?.value;

    if (!token) {
      if (pathname.startsWith("/api")) {
        return applyAllHeaders(
          req,
          NextResponse.json(
            { message: "Unauthorized: No session" },
            { status: 401 },
          ),
        );
      }
      return NextResponse.redirect(new URL("/", req.url));
    }

    try {
      const secret = new TextEncoder().encode(process.env.API_SECRET_KEY);
      const { payload } = await jwtVerify(token, secret);

      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("x-user-id", String(payload.userId));
      requestHeaders.set("x-user-role", payload.userRole || "");

      try {
        const licensed = payload?.licensedModules || [];
        requestHeaders.set("x-licensed-modules", JSON.stringify(licensed));
      } catch {
        // Optional license metadata should not block authenticated requests.
      }

      return applyAllHeaders(
        req,
        NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        }),
      );
    } catch (err) {
      console.warn("JWT verify failed in proxy:", err?.message || err);
      if (pathname.startsWith("/api")) {
        return applyAllHeaders(
          req,
          NextResponse.json(
            { message: "Unauthorized: Invalid session" },
            { status: 401 },
          ),
        );
      }
      return NextResponse.redirect(new URL("/", req.url));
    }
  }

  return applyAllHeaders(req, NextResponse.next());
}
