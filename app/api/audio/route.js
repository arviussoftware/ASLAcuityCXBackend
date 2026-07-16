// app/api/audio/route.js
// Strategy: return a short-lived presigned URL for S3/GCS/public sources.
// The browser fetches audio directly from the source — bypasses Amplify's
// 6 MB Lambda response limit entirely. Lambda only serves a tiny JSON response.
// Local/network files are still streamed through the API (they have no public URL).

import fs from "fs";
import path from "path";
import { S3Client, HeadObjectCommand, GetObjectCommand, RestoreObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import mime from "mime-types";
import { logAudit } from "@/lib/auditLogger";
import { promisify } from "util";
import { execFile } from "child_process";
import { isInvalid } from "@/lib/generic";
import { NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import { logError, logWarning } from "@/lib/errorLogger";
import { getAWSCredentials } from "@/lib/connectionCredentials";
import { writeRestoreRecord } from "@/lib/glacierRestoreTracker";

const execFilePromise = promisify(execFile);

function getMimeType(filePath) {
  if (!filePath) return "audio/mpeg";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".m4a") {
    return "audio/x-m4a";
  }
  return mime.lookup(filePath) || "audio/mpeg";
}

/* ── CORS: allowlisted origins (mirrors proxy.js allowlist) ── */
const AUDIO_ALLOWED_ORIGINS = new Set([
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  ...(process.env.OAUTH_ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
]);

/**
 * Returns an allowed CORS origin string for the given request.
 * Falls back to the configured FRONTEND_ORIGIN env var instead of wildcard.
 */
function getCorsOrigin(request) {
  const rawOrigin = request?.headers?.get("origin") ||
                    request?.headers?.get("referer") || "";
  if (rawOrigin) {
    try {
      const { protocol, host } = new URL(rawOrigin);
      const originUrl = `${protocol}//${host}`;
      if (AUDIO_ALLOWED_ORIGINS.has(originUrl)) return originUrl;
    } catch (_) { /* ignore malformed origin */ }
  }
  // Restrict to the configured frontend URL — never return wildcard
  return process.env.FRONTEND_ORIGIN || "http://localhost:5000";
}

/* ── Path traversal guard ── */
function validateFilePath(filePath) {
  if (!filePath) return false;
  if (
    filePath.startsWith("s3://") || filePath.startsWith("gs://") ||
    filePath.startsWith("http://") || filePath.startsWith("https://")
  ) return true;

  // Convert all forward slashes to backslashes for uniform Windows handling
  let normalized = filePath.replace(/\//g, "\\");
  
  // Clean up duplicate slashes (except the leading double backslash of UNC paths)
  const isUNC = normalized.startsWith("\\\\");
  if (isUNC) {
    normalized = "\\\\" + normalized.slice(2).replace(/\\+/g, "\\");
  } else {
    normalized = normalized.replace(/\\+/g, "\\");
  }

  // Must be absolute path or UNC network path
  if (!normalized.startsWith("\\\\") && !/^[a-zA-Z]:\\/.test(normalized)) {
    return false;
  }

  // Reject directory traversal
  const segments = normalized.split("\\");
  if (segments.includes("..") || segments.includes(".")) {
    return false;
  }

  // Reject sensitive OS/system directories
  let checkPath = normalized.toLowerCase();
  
  // Strip leading UNC host and share prefix
  if (isUNC) {
    const parts = checkPath.slice(2).split("\\").filter(Boolean);
    if (parts.length >= 2) {
      checkPath = parts.slice(2).join("\\");
    } else {
      checkPath = "";
    }
  } else {
    // Strip drive letter
    if (/^[a-z]:/i.test(checkPath)) {
      checkPath = checkPath.slice(2);
    }
  }

  if (checkPath.startsWith("\\")) {
    checkPath = checkPath.slice(1);
  }

  const sensitiveDirectories = new Set([
    "windows", "winnt", "system32", "program files", "program files (x86)",
    "users", "recovery", "boot", "etc", "var", "usr", "bin", "sbin", "opt",
    "sys", "proc", "dev", "lib", "boot", "root", "home"
  ]);

  const pathParts = checkPath.split("\\");
  if (pathParts.length > 0 && sensitiveDirectories.has(pathParts[0])) {
    return false;
  }

  return true;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ── HEAD handler — lets browser probe file size before seeking ── */
export async function HEAD(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fullFilePath   = searchParams.get("filePath");
    const fileSourceType = searchParams.get("fileSourceType");
    const authHeader     = request.headers.get("authorization") || "";
    const authQuery      = searchParams.get("auth") || "";
    const token          = authHeader.replace("Bearer ", "") || authQuery;

    if (token !== process.env.NEXT_PUBLIC_API_TOKEN) {
      logWarning("HEAD /api/audio", "Unauthorized access attempt", { url: request.url });
      return new Response(null, { status: 401 });
    }
    if (isInvalid(fullFilePath)) {
      logWarning("HEAD /api/audio", "Missing filePath parameter", { url: request.url });
      return new Response(null, { status: 400 });
    }
    if (!validateFilePath(fullFilePath)) {
      logWarning("HEAD /api/audio", "Path traversal/unsafe path detected", { filePath: fullFilePath });
      return new Response(null, { status: 400 });
    }

    const isS3Path = fullFilePath.startsWith("s3://") || fileSourceType === "aws-s3";
    if (isS3Path) {
      const creds = await getAWSCredentials();
      let bucket = creds.BUCKET;
      let key    = fullFilePath;
      if (fullFilePath.startsWith("s3://")) {
        const wp = fullFilePath.slice(5);
        const si = wp.indexOf("/");
        bucket = wp.slice(0, si);
        key    = wp.slice(si + 1);
      }
      const s3Client = new S3Client({
        region: creds.REGION,
        credentials: {
          accessKeyId: creds.AWS_ACCESS_KEY_ID,
          secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
        },
      });
      const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
      const head = await s3Client.send(command);
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Length":              String(head.ContentLength || 0),
          "Content-Type":                getMimeType(key),
          "Accept-Ranges":               "bytes",
          "Access-Control-Allow-Origin": getCorsOrigin(request),
          "Vary":                        "Origin",
        },
      });
    }
    return new Response(null, { status: 200, headers: { "Accept-Ranges": "bytes" } });
  } catch (error) {
    let filePath = "unknown";
    try {
      const { searchParams } = new URL(request.url);
      filePath = searchParams.get("filePath") || "unknown";
    } catch (_) {}
    logError("HEAD /api/audio", error, { filePath });
    return new Response(null, { status: 500 });
  }
}

export async function GET(request) {
  let fullFilePath   = null;
  let fileSourceType = null;
  let userName       = null;
  let loggedInUserId = null;
  try {
    const { searchParams } = new URL(request.url);
    const actionType     = searchParams.get("actionType");
    fullFilePath   = searchParams.get("filePath");
    const interactionId  = searchParams.get("interactionId");
    fileSourceType = searchParams.get("fileSourceType");
    userName       = request.headers.get("userName");
    loggedInUserId = request.headers.get("loggedInUserId");
    const rangeHeader    = request.headers.get("range");

    const authHeader = request.headers.get("authorization") || "";
    const authQuery  = searchParams.get("auth") || "";
    const token      = authHeader.replace("Bearer ", "") || authQuery;
    if (token !== process.env.NEXT_PUBLIC_API_TOKEN) {
      logWarning("GET /api/audio", "Unauthorized access attempt", { userName, loggedInUserId });
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (isInvalid(fullFilePath)) {
      logWarning("GET /api/audio", "Missing filePath parameter", { url: request.url });
      return NextResponse.json({ message: "Missing filePath parameter." }, { status: 400 });
    }
    if (!validateFilePath(fullFilePath)) {
      logWarning("GET /api/audio", "Path traversal/unsafe path detected", { filePath: fullFilePath });
      return NextResponse.json({ message: "Invalid filePath parameter." }, { status: 400 });
    }
    if (interactionId && !/^\d+$/.test(interactionId)) {
      logWarning("GET /api/audio", "Invalid interactionId detected (injection attempt)", { interactionId });
      return NextResponse.json({ message: "Invalid interactionId parameter." }, { status: 400 });
    }

    // Audit — fire-and-forget
    if (interactionId && actionType !== "load") {
      logAudit({
        userId: loggedInUserId,
        userName,
        interactionId: parseInt(interactionId, 10),
        actionType: actionType === "download" ? "DOWNLOAD_AUDIO" : "PLAY_AUDIO",
        description: actionType === "download" ? "User downloaded audio" : "User played audio",
      }).catch((err) => console.error("[audit] audio log failed:", err));
    }

    const isGcsPath    = fullFilePath.startsWith("gs://");
    const isGcsHttpUrl = fullFilePath.startsWith("https://storage.googleapis.com/") ||
                         fullFilePath.startsWith("https://storage.cloud.google.com/");
    const isS3Path     = fullFilePath.startsWith("s3://");
    const isPublicUrl  = (fullFilePath.startsWith("https://") || fullFilePath.startsWith("http://")) && !isGcsHttpUrl;
    const shouldStream = searchParams.get("stream") === "1";

    // ── Cloud sources: return presigned URL as JSON (Default) ──
    // Browser fetches audio directly from S3/GCS — no Lambda proxy, no 6MB limit.
    // If stream=1 is requested, we proxy the data (useful for avoiding CORS in waveform decoding)
    if (isGcsPath || isGcsHttpUrl || (!isS3Path && !isPublicUrl && fileSourceType === "gcp")) {
      if (shouldStream) return getGCSStream(fullFilePath, request);
      const url = `/api/audio?filePath=${encodeURIComponent(fullFilePath)}&stream=1&fileSourceType=gcp&auth=${encodeURIComponent(process.env.NEXT_PUBLIC_API_TOKEN || "")}`;
      return NextResponse.json({ url });
    }

    if (isS3Path || (!isGcsPath && !isGcsHttpUrl && !isPublicUrl && fileSourceType === "aws-s3")) {
      // 1. If actionType is retrieve, trigger S3 restore
      if (actionType === "retrieve") {
        try {
          const creds = await getAWSCredentials();
          let bucket = creds.BUCKET;
          let key    = fullFilePath;
          if (fullFilePath.startsWith("s3://")) {
            const wp = fullFilePath.slice(5);
            const si = wp.indexOf("/");
            bucket = wp.slice(0, si);
            key    = wp.slice(si + 1);
          }
          const s3Client = new S3Client({
            region: creds.REGION,
            credentials: {
              accessKeyId: creds.AWS_ACCESS_KEY_ID,
              secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
            },
          });
          const command = new RestoreObjectCommand({
            Bucket: bucket,
            Key: key,
            RestoreRequest: {
              Days: 7, // keep restored for 7 days
              GlacierJobParameters: {
                Tier: "Standard",
              },
            },
          });
          await s3Client.send(command);
          return NextResponse.json({ status: "retrieving", message: "The call is retrieving..." });
        } catch (restoreErr) {
          if (restoreErr.name === "RestoreAlreadyInProgress" || restoreErr.message?.includes("RestoreAlreadyInProgress")) {
            return NextResponse.json({ status: "retrieving", message: "The call is retrieving..." });
          }
          console.error("[S3 restore request failed]:", restoreErr.message);
          return NextResponse.json({ message: "Failed to initiate retrieval: " + restoreErr.message }, { status: 500 });
        }
      }

      // 2. Check archived status
      try {
        const creds = await getAWSCredentials();
        let bucket = creds.BUCKET;
        let key    = fullFilePath;
        if (fullFilePath.startsWith("s3://")) {
          const wp = fullFilePath.slice(5);
          const si = wp.indexOf("/");
          bucket = wp.slice(0, si);
          key    = wp.slice(si + 1);
        }
        const s3Client = new S3Client({
          region: creds.REGION,
          credentials: {
            accessKeyId: creds.AWS_ACCESS_KEY_ID,
            secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
          },
        });
        const headCmd = new HeadObjectCommand({ Bucket: bucket, Key: key });
        const head = await s3Client.send(headCmd);

        const isArchived = head.StorageClass === "GLACIER" || head.StorageClass === "DEEP_ARCHIVE";
        if (isArchived) {
          const restore = head.Restore || "";
          if (restore.includes('ongoing-request="true"')) {
            if (interactionId) {
              await writeRestoreRecord({
                interactionId,
                filePath: fullFilePath,
                status: "IN_PROGRESS",
              }).catch(() => {});
            }
            return NextResponse.json({ status: "retrieving", message: "The call is retrieving..." });
          } else if (restore.includes('ongoing-request="false"')) {
            const expiryMatch = restore.match(/expiry-date="([^"]+)"/);
            if (expiryMatch) {
              const expiryDate = new Date(expiryMatch[1]);
              if (expiryDate < new Date()) {
                if (interactionId) {
                  await writeRestoreRecord({
                    interactionId,
                    filePath: fullFilePath,
                    status: "NEEDS_RETRIEVAL",
                  }).catch(() => {});
                }
                return NextResponse.json({ status: "needs_retrieval", message: "The call needs to be retrieved." });
              }
            }
            // Already retrieved/restored and not expired! Serve normal.
          } else {
            // Needs retrieval
            if (interactionId) {
              await writeRestoreRecord({
                interactionId,
                filePath: fullFilePath,
                status: "NEEDS_RETRIEVAL",
              }).catch(() => {});
            }
            return NextResponse.json({ status: "needs_retrieval", message: "The call needs to be retrieved." });
          }
        }
      } catch (headErr) {
        logError("GET /api/audio (S3 head check)", headErr, { filePath: fullFilePath });
      }

      if (shouldStream) return getS3Stream(fullFilePath, rangeHeader, request);
      // ── Return a real presigned S3 URL so the browser streams directly from S3
      // instead of proxying all bytes through this server (which was very slow).
      try {
        const presignedUrl = await getS3PresignedUrl(fullFilePath);
        return NextResponse.json({ url: presignedUrl, status: "retrieved" });
      } catch (presignErr) {
        logError("GET /api/audio (S3 presign)", presignErr, { filePath: fullFilePath });
        const url = `/api/audio?filePath=${encodeURIComponent(fullFilePath)}&stream=1&fileSourceType=aws-s3&auth=${encodeURIComponent(process.env.NEXT_PUBLIC_API_TOKEN || "")}`;
        return NextResponse.json({ url, status: "retrieved" });
      }
    }

    if (isPublicUrl) {
      // Public URL — return as-is, browser fetches directly
      return NextResponse.json({ url: fullFilePath });
    }

    // ── Local / network sources: stream through API (no public URL available) ──
    if (fileSourceType === "network" || fullFilePath.startsWith("\\\\")) {
      return getNetworkDriveStream(fullFilePath, request);
    }

    return getLocalDriveStream(fullFilePath, rangeHeader, request);

  } catch (error) {
    logError("GET /api/audio", error, { filePath: fullFilePath, fileSourceType, userName, loggedInUserId });
    // Return generic message — never expose raw error details to clients
    return NextResponse.json({ message: "Internal server error." }, { status: 500 });
  }
}

/* ── AWS S3 presigned URL (1 hour expiry) ── */
async function getS3PresignedUrl(fullFilePath) {
  const creds = await getAWSCredentials();
  let bucket = creds.BUCKET;
  let key    = fullFilePath;

  if (fullFilePath.startsWith("s3://")) {
    const withoutPrefix = fullFilePath.slice(5);
    const slashIdx = withoutPrefix.indexOf("/");
    bucket = withoutPrefix.slice(0, slashIdx);
    key    = withoutPrefix.slice(slashIdx + 1);
  }

  const s3Client = new S3Client({
    region: creds.REGION,
    credentials: {
      accessKeyId: creds.AWS_ACCESS_KEY_ID,
      secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
    },
  });

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour — prevents expired-URL media errors on slow networks / idle tabs
}

/* ── GCS presigned URL ── */
async function getGCSPresignedUrl(fullFilePath) {
  const keyFile   = process.env.GCP_KEY_FILE;
  const projectId = process.env.GCP_PROJECT_ID;

  let bucketName, filePath;
  if (fullFilePath.startsWith("gs://")) {
    const withoutPrefix = fullFilePath.slice(5);
    const slashIdx = withoutPrefix.indexOf("/");
    bucketName = withoutPrefix.slice(0, slashIdx);
    filePath   = withoutPrefix.slice(slashIdx + 1);
  } else if (fullFilePath.startsWith("https://storage.googleapis.com/") ||
             fullFilePath.startsWith("https://storage.cloud.google.com/")) {
    const url   = new URL(fullFilePath);
    const parts = url.pathname.slice(1).split("/");
    bucketName  = parts[0];
    filePath    = parts.slice(1).join("/");
  } else {
    bucketName = process.env.GCP_BUCKET;
    filePath   = fullFilePath;
  }

  if (keyFile && projectId && fs.existsSync(keyFile)) {
    const storage = new Storage({ projectId, keyFilename: keyFile });
    const [signedUrl] = await storage.bucket(bucketName).file(filePath).getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + 5 * 60 * 1000,
    });
    return signedUrl;
  }

  // No credentials — return public URL
  return fullFilePath.startsWith("https://")
    ? fullFilePath
    : `https://storage.googleapis.com/${bucketName}/${filePath}`;
}

/* ── Shared response headers for streamed responses ── */
// request is passed through to resolve the CORS origin dynamically.
function audioHeaders(contentType, request, extra = {}) {
  return {
    "Content-Type":                contentType,
    "Accept-Ranges":               "bytes",
    "Cache-Control":               "no-store",
    "Access-Control-Allow-Origin": getCorsOrigin(request),
    "Vary":                        "Origin",
    ...extra,
  };
}

/* ── Network drive — stream through API ── */
async function getNetworkDriveStream(fullFilePath, request) {
  // Normalize slashes: convert forward slashes to backslashes
  const normalizedPath = fullFilePath.replace(/\//g, "\\");

  // Parse UNC path: \\host\share\...
  const parts = normalizedPath.replace(/^\\\\/, "").split("\\").filter(Boolean);
  if (parts.length < 2) {
    logWarning("GET /api/audio (network)", "Invalid UNC path — missing host or share", { filePath: fullFilePath });
    return NextResponse.json({ message: "Invalid network path." }, { status: 400 });
  }

  // Validate host and share: only safe alphanumeric characters, hyphens, underscores, dots allowed
  const safeSegment = /^[\w.\-]+$/;
  if (!safeSegment.test(parts[0]) || !safeSegment.test(parts[1])) {
    logWarning("GET /api/audio (network)", "Unsafe characters in UNC host/share", { filePath: fullFilePath });
    return NextResponse.json({ message: "Invalid network path." }, { status: 400 });
  }

  const networkUserName = process.env.NETWORKNAME;
  const networkPassword = process.env.NETWORKPASSWORD;
  const rootDir         = `\\\\${parts[0]}\\${parts[1]}`;

  try {
    // Check existing connections — safe shell-less execution with 5s timeout
    const { stdout: netUseOutput } = await execFilePromise("net.exe", ["use"], { timeout: 5000 });
    if (netUseOutput.includes(rootDir)) {
      await execFilePromise("net.exe", ["use", rootDir, "/delete"], { timeout: 5000 });
    }

    // Mount using execFile — arguments are passed as separate array entries,
    // completely bypassing shell interpretation. No injection possible. (5s timeout)
    await execFilePromise("net.exe", [
      "use",
      rootDir,
      `/user:${networkUserName}`,
      networkPassword,
      "/persistent:no",
    ], { timeout: 5000 });
  } catch (mountErr) {
    logError("GET /api/audio (network) mount", mountErr, { rootDir });
    return NextResponse.json({ message: "Failed to mount network drive." }, { status: 500 });
  }

  if (!fs.existsSync(normalizedPath)) {
    logWarning("GET /api/audio (network)", "Audio file not found on network drive", { filePath: normalizedPath });
    return NextResponse.json({ message: "audio file not found" }, { status: 404 });
  }

  const contentType = getMimeType(normalizedPath);
  const audioStream = fs.createReadStream(normalizedPath);
  return new Response(audioStream, { headers: audioHeaders(contentType, request) });
}

/* ── Local drive — stream with range support ── */
async function getLocalDriveStream(fullFilePath, rangeHeader, request) {
  if (!fs.existsSync(fullFilePath)) {
    logWarning("GET /api/audio (local)", "Audio file not found on local drive", { filePath: fullFilePath });
    return NextResponse.json({ message: "File not found" }, { status: 404 });
  }

  const contentType = getMimeType(fullFilePath);
  const stat        = fs.statSync(fullFilePath);
  const fileSize    = stat.size;

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
    const start     = parseInt(startStr, 10);
    const end       = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const audioStream = fs.createReadStream(fullFilePath, { start, end });
    return new Response(audioStream, {
      status: 206,
      headers: audioHeaders(contentType, request, {
        "Content-Range":  `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": String(chunkSize),
      }),
    });
  }

  const audioStream = fs.createReadStream(fullFilePath);
  return new Response(audioStream, {
    status: 200,
    headers: audioHeaders(contentType, request, {
      "Content-Length":      String(fileSize),
      "Content-Disposition": `inline; filename="${path.basename(fullFilePath)}"`,
    }),
  });
}

/* ── S3 — stream through API (bypasses CORS) ── */
async function getS3Stream(fullFilePath, rangeHeader, request) {
  const url = await getS3PresignedUrl(fullFilePath);

  const fetchHeaders = {};
  if (rangeHeader) {
    fetchHeaders["Range"] = rangeHeader;
  }

  const res = await fetch(url, { headers: fetchHeaders });
  let contentType = res.headers.get("content-type") || "audio/mpeg";
  if (contentType === "application/octet-stream" || contentType === "binary/octet-stream") {
    contentType = getMimeType(fullFilePath);
  } else if (fullFilePath.toLowerCase().endsWith(".m4a")) {
    contentType = "audio/x-m4a";
  }

  return new Response(res.body, {
    status: res.status,
    headers: audioHeaders(contentType, request, {
      "Content-Length": res.headers.get("content-length") || undefined,
      "Content-Range":  res.headers.get("content-range") || undefined,
    }),
  });
}

/* ── GCS — stream through API (bypasses CORS) ── */
async function getGCSStream(fullFilePath, request) {
  const url = await getGCSPresignedUrl(fullFilePath);
  const res = await fetch(url);
  let contentType = res.headers.get("content-type") || "audio/mpeg";
  if (contentType === "application/octet-stream" || contentType === "binary/octet-stream") {
    contentType = getMimeType(fullFilePath);
  } else if (fullFilePath.toLowerCase().endsWith(".m4a")) {
    contentType = "audio/x-m4a";
  }
  return new Response(res.body, {
    headers: audioHeaders(contentType, request),
  });
}
