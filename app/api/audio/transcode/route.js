// app/api/audio/transcode/route.js
// Converts any audio file to MP3 using ffmpeg (buffered — waits for full conversion).
// Used when a browser cannot natively decode the source codec (e.g. G.711, GSM WAV).

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getAWSCredentials } from "@/lib/connectionCredentials";
import { logError, logWarning } from "@/lib/errorLogger";
import { isInvalid } from "@/lib/generic";
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import path from "path";

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
export const maxDuration = 120;

/* ── CORS ── */
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  ...(process.env.OAUTH_ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
]);

function getCorsOrigin(request) {
  const rawOrigin =
    request?.headers?.get("origin") ||
    request?.headers?.get("referer") || "";
  if (rawOrigin) {
    try {
      const { protocol, host } = new URL(rawOrigin);
      const originUrl = `${protocol}//${host}`;
      if (ALLOWED_ORIGINS.has(originUrl)) return originUrl;
    } catch (_) {}
  }
  return process.env.FRONTEND_ORIGIN || "http://localhost:5000";
}

async function resolveSourceUrl(filePath, fileSourceType) {
  const isS3 = filePath.startsWith("s3://") || fileSourceType === "aws-s3";

  if (isS3) {
    const creds = await getAWSCredentials();
    let bucket = creds.BUCKET;
    let key = filePath;

    if (filePath.startsWith("s3://")) {
      const without = filePath.slice(5);
      const slash = without.indexOf("/");
      bucket = without.slice(0, slash);
      key = without.slice(slash + 1);
    }

    const s3 = new S3Client({
      region: creds.REGION,
      credentials: {
        accessKeyId: creds.AWS_ACCESS_KEY_ID,
        secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
      },
    });

    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 }); // 1 hour
  }

  if (filePath.startsWith("https://") || filePath.startsWith("http://")) {
    return filePath;
  }

  return filePath; // local/network path
}

/**
 * Run ffmpeg and collect the COMPLETE MP3 output into a single Buffer.
 * Buffered (not streamed) — ensures the client only gets bytes if ffmpeg succeeds.
 */
function runFfmpeg(sourceUrl) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error("ffmpeg-static binary not found on this system."));
    }

    const args = [
      "-hide_banner", "-loglevel", "error",
      "-i", sourceUrl,
      "-vn",                    // no video
      "-acodec", "libmp3lame",  // encode as MP3
      "-ab", "128k",            // 128 kbps
      "-ar", "16000",           // 16 kHz (telephony quality)
      "-ac", "1",               // mono
      "-f", "mp3",
      "pipe:1",                 // write MP3 to stdout
    ];

    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });

    // Set a safety timeout to kill ffmpeg if it hangs (e.g. on unresolvable paths/network latency)
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Transcoding timed out after 15 seconds."));
    }, 15000);

    const mp3Chunks = [];
    const errChunks = [];

    proc.stdout.on("data", (chunk) => mp3Chunks.push(chunk));
    proc.stderr.on("data", (chunk) => errChunks.push(chunk));

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      const stderr = Buffer.concat(errChunks).toString().trim();
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`));
      }
      const mp3 = Buffer.concat(mp3Chunks);
      if (mp3.length === 0) {
        return reject(new Error(`ffmpeg produced no output. ${stderr.slice(0, 200)}`));
      }
      resolve(mp3);
    });
  });
}

export async function GET(request) {
  let filePath = null;
  try {
    const { searchParams } = new URL(request.url);
    filePath = searchParams.get("filePath");
    const fileSourceType = searchParams.get("fileSourceType") || "";

    // Auth
    const authHeader = request.headers.get("authorization") || "";
    const authQuery  = searchParams.get("auth") || "";
    const token = authHeader.replace("Bearer ", "") || authQuery;
    if (token !== process.env.NEXT_PUBLIC_API_TOKEN) {
      logWarning("GET /api/audio/transcode", "Unauthorized", { filePath });
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (isInvalid(filePath)) {
      return NextResponse.json({ message: "Missing filePath." }, { status: 400 });
    }
    if (!validateFilePath(filePath)) {
      logWarning("GET /api/audio/transcode", "Unsafe path blocked", { filePath });
      return NextResponse.json({ message: "Invalid or unsafe filePath." }, { status: 400 });
    }

    const sourceUrl = await resolveSourceUrl(filePath, fileSourceType);

    // Transcode — waits for the complete MP3 before responding
    const mp3Buffer = await runFfmpeg(sourceUrl);

    return new Response(mp3Buffer, {
      status: 200,
      headers: {
        "Content-Type":                "audio/mpeg",
        "Content-Length":              String(mp3Buffer.length),
        "Cache-Control":               "no-store",
        "Access-Control-Allow-Origin": getCorsOrigin(request),
        "Vary":                        "Origin",
        "Content-Disposition":         `inline; filename="audio.mp3"`,
      },
    });
  } catch (error) {
    logError("GET /api/audio/transcode", error, { filePath });
    return NextResponse.json(
      { message: "Transcoding failed: " + error.message },
      { status: 500 }
    );
  }
}
