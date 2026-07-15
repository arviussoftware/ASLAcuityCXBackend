import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import { Storage } from "@google-cloud/storage";
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import { S3Client, GetObjectCommand, HeadObjectCommand, RestoreObjectCommand } from "@aws-sdk/client-s3";
import { logError, logWarning } from "@/lib/errorLogger";
import { getAWSCredentials } from "@/lib/connectionCredentials";

const execFilePromise = promisify(execFile);
export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

function validateFilePath(filePath) {
  if (!filePath) return false;
  // Cloud and HTTP paths are not subject to local traversal
  if (
    filePath.startsWith("s3://") ||
    filePath.startsWith("gs://") ||
    filePath.startsWith("http://") ||
    filePath.startsWith("https://")
  ) return true;

  // Normalize all slashes to backslashes for consistent Windows handling
  let normalized = filePath.replace(/\//g, "\\");
  const isUNC = normalized.startsWith("\\\\");
  if (isUNC) {
    normalized = "\\\\" + normalized.slice(2).replace(/\\+/g, "\\");
  } else {
    normalized = normalized.replace(/\\+/g, "\\");
  }

  // Reject directory traversal sequences
  const segments = normalized.split("\\");
  if (segments.includes("..") || segments.includes(".")) return false;

  // Reject sensitive OS/system directories at the root level
  let checkPath = normalized.toLowerCase();
  if (isUNC) {
    const parts = checkPath.slice(2).split("\\").filter(Boolean);
    checkPath = parts.length >= 2 ? parts.slice(2).join("\\") : "";
  } else {
    if (/^[a-z]:/i.test(checkPath)) checkPath = checkPath.slice(2);
  }
  if (checkPath.startsWith("\\")) checkPath = checkPath.slice(1);

  const sensitiveDirectories = new Set([
    "windows", "winnt", "system32", "program files", "program files (x86)",
    "users", "recovery", "boot", "etc", "var", "usr", "bin", "sbin", "opt",
    "sys", "proc", "dev", "lib", "root", "home"
  ]);
  const firstPart = checkPath.split("\\")[0];
  if (firstPart && sensitiveDirectories.has(firstPart)) return false;

  // Must be absolute path or UNC network path
  if (!normalized.startsWith("\\\\") && !/^[a-zA-Z]:\\/.test(normalized)) return false;
  return true;
}

// Numeric DB values → string type names (in case DB stores 1/2/3/4)
const NUMERIC_TYPE_MAP = { "1": "network", "2": "local", "3": "aws-s3", "4": "gcp" };

function resolveSourceType(rawType, filePath) {
  // Path-based detection always wins — overrides whatever is in DB
  if (filePath.startsWith("https://") || filePath.startsWith("http://")) return "public-url";
  if (filePath.startsWith("gs://")) return "gcp";
  if (filePath.startsWith("s3://")) return "aws-s3";
  if (filePath.startsWith("\\\\") || filePath.startsWith("//")) return "network";

  let t = (rawType || "").toLowerCase().trim();

  // Map numeric DB values
  if (NUMERIC_TYPE_MAP[t]) t = NUMERIC_TYPE_MAP[t];

  // Use DB value if it's a known type
  const known = ["aws-s3", "network", "local", "gcp", "public-url"];
  if (known.includes(t)) return t;

  return "local";
}

export async function GET(req) {
  try {
    // ── Auth check ──────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
      logWarning("GET /api/read-transcription", "Unauthorized access attempt", { url: req.url });
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get("path");
    const rawSourceType = searchParams.get("fileSourceType");
    const actionType = searchParams.get("actionType");

    if (isInvalid(filePath)) {
      logWarning("GET /api/read-transcription", "Missing path parameter", { url: req.url });
      return NextResponse.json(
        { message: "path parameter is missing or invalid." },
        { status: 400 }
      );
    }

    // ── Path traversal guard ─────────────────────────────────────────────
    if (!validateFilePath(filePath)) {
      logWarning("GET /api/read-transcription", "Path traversal/unsafe path detected", { filePath });
      return NextResponse.json(
        { message: "Invalid file path: unsafe characters detected." },
        { status: 400 }
      );
    }

    const fileSourceType = resolveSourceType(rawSourceType, filePath);

    // Always treat https:// / http:// as public URL — overrides any DB source type value
    const isPublicUrl = filePath.startsWith("https://") || filePath.startsWith("http://");

    let transcriptionData = null;

    if (isPublicUrl) {
      transcriptionData = await getPublicUrlTranscription(filePath);
    } else if (fileSourceType === "aws-s3") {
      transcriptionData = await getAWSTranscription(filePath, actionType);
    } else if (fileSourceType === "network") {
      transcriptionData = await getNetworkTranscription(filePath);
    } else if (fileSourceType === "local") {
      transcriptionData = await getLocalTranscription(filePath);
    } else if (fileSourceType === "gcp" || filePath.startsWith("gs://")) {
      transcriptionData = await getGCPTranscription(filePath);
    } else if (fileSourceType === "public-url") {
      transcriptionData = await getPublicUrlTranscription(filePath);
    }

    return NextResponse.json(transcriptionData);
  } catch (error) {
    let filePath = "unknown";
    try {
      const { searchParams } = new URL(req.url);
      filePath = searchParams.get("path") || "unknown";
    } catch (_) {}
    logError("GET /api/read-transcription", error, { filePath });
    // Return generic message — never expose raw internal error details to clients
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

async function getAWSTranscription(fullFilePath, actionType) {
  const creds = await getAWSCredentials();
  const s3 = new S3Client({
    region: creds.REGION,
    credentials: {
      accessKeyId: creds.AWS_ACCESS_KEY_ID,
      secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
    },
  });

  // Parse s3://bucket/key format
  let bucket = creds.BUCKET;
  let key    = fullFilePath;
  if (fullFilePath.startsWith("s3://")) {
    const without = fullFilePath.slice(5);
    const idx     = without.indexOf("/");
    bucket = without.slice(0, idx);
    key    = without.slice(idx + 1);
  }

  // Check Glacier/Deep Archive status
  try {
    const headCmd = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const head = await s3.send(headCmd);
    const isArchived = head.StorageClass === "GLACIER" || head.StorageClass === "DEEP_ARCHIVE";
    if (isArchived) {
      const restore = head.Restore || "";
      if (restore.includes('ongoing-request="true"')) {
        return { status: "retrieving", message: "The transcription is retrieving..." };
      } else if (restore.includes('ongoing-request="false"')) {
        const expiryMatch = restore.match(/expiry-date="([^"]+)"/);
        if (expiryMatch) {
          const expiryDate = new Date(expiryMatch[1]);
          if (expiryDate < new Date()) {
            // Restored period has expired! Treat it as needs retrieval.
            if (actionType === "retrieve") {
              try {
                const restoreCmd = new RestoreObjectCommand({
                  Bucket: bucket,
                  Key: key,
                  RestoreRequest: {
                    Days: 7,
                    GlacierJobParameters: { Tier: "Standard" }
                  }
                });
                await s3.send(restoreCmd);
              } catch (restoreErr) {
                if (restoreErr.name !== "RestoreAlreadyInProgress" && !restoreErr.message?.includes("RestoreAlreadyInProgress")) {
                  console.error("[S3 transcription restore request failed]:", restoreErr.message);
                }
              }
              return { status: "retrieving", message: "The transcription is retrieving..." };
            } else {
              return { status: "needs_retrieval", message: "The transcription needs to be retrieved." };
            }
          }
        }
        // Already retrieved/restored! Proceed to load.
      } else {
        // Needs retrieval.
        if (actionType === "retrieve") {
          try {
            const restoreCmd = new RestoreObjectCommand({
              Bucket: bucket,
              Key: key,
              RestoreRequest: {
                Days: 7,
                GlacierJobParameters: { Tier: "Standard" }
              }
            });
            await s3.send(restoreCmd);
          } catch (restoreErr) {
            if (restoreErr.name !== "RestoreAlreadyInProgress" && !restoreErr.message?.includes("RestoreAlreadyInProgress")) {
              console.error("[S3 transcription restore request failed]:", restoreErr.message);
            }
          }
          return { status: "retrieving", message: "The transcription is retrieving..." };
        } else {
          return { status: "needs_retrieval", message: "The transcription needs to be retrieved." };
        }
      }
    }
  } catch (headErr) {
    console.error("[S3 transcription head check failed]:", headErr.message);
  }

  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const jsonText = await streamToString(response.Body);
  return JSON.parse(jsonText);
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

/* ── GCP ── */
async function getGCPTranscription(fullFilePath) {
  const keyFile = process.env.GCP_KEY_FILE;
  const projectId = process.env.GCP_PROJECT_ID;

  if (!keyFile || !projectId) {
    throw new Error("GCP not configured: GCP_KEY_FILE or GCP_PROJECT_ID missing in .env");
  }
  if (!fs.existsSync(keyFile)) {
    throw new Error(`GCP key file not found at path: "${keyFile}". Place your service account JSON at that location.`);
  }

  const storage = new Storage({ projectId, keyFilename: keyFile });

  let bucketName, filePath;
  if (fullFilePath.startsWith("gs://")) {
    const withoutPrefix = fullFilePath.slice(5);
    const slashIdx = withoutPrefix.indexOf("/");
    bucketName = withoutPrefix.slice(0, slashIdx);
    filePath   = withoutPrefix.slice(slashIdx + 1);
  } else {
    bucketName = process.env.GCP_BUCKET;
    filePath   = fullFilePath;
  }

  const file = storage.bucket(bucketName).file(filePath);
  const [exists] = await file.exists();
  if (!exists) throw new Error(`File "${filePath}" not found in GCP bucket "${bucketName}".`);
  const [contents] = await file.download();
  const raw = contents.toString("utf-8");
  const cleaned = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return JSON.parse(cleaned);
}

/* ── Network Drive ── */
async function getNetworkTranscription(fullFilePath) {
  // Normalize slashes to backslashes
  const normalizedPath = fullFilePath.replace(/\//g, "\\");

  // Parse UNC path: \\host\share\...
  const parts = normalizedPath.replace(/^\\\\/, "").split("\\").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Invalid UNC path: missing host or share segment");
  }

  // Validate host and share — only safe characters allowed
  const safeSegment = /^[\w.\-]+$/;
  if (!safeSegment.test(parts[0]) || !safeSegment.test(parts[1])) {
    throw new Error("Unsafe characters detected in UNC path host or share");
  }

  const rootDir = `\\\\${parts[0]}\\${parts[1]}`;

  // Use execFile — arguments as separate array, never run through a shell
  const { stdout } = await execFilePromise("net.exe", ["use"]);
  if (stdout.includes(rootDir)) {
    await execFilePromise("net.exe", ["use", rootDir, "/delete"]);
  }
  await execFilePromise("net.exe", [
    "use",
    rootDir,
    `/user:${process.env.NETWORKNAME}`,
    process.env.NETWORKPASSWORD,
    "/persistent:no",
  ]);

  if (!fs.existsSync(normalizedPath)) throw new Error("Transcription file not found on network drive");
  const fileContent = await fsPromises.readFile(normalizedPath, "utf-8");
  return JSON.parse(fileContent);
}

/* ── Local ── */
async function getLocalTranscription(fullFilePath) {
  const normalizedPath = fullFilePath.replace(/\//g, "\\");
  if (!fs.existsSync(normalizedPath)) {
    logWarning("GET /api/read-transcription (local)", "Transcription file not found", { filePath: normalizedPath });
    return { error: "No transcription available for this interaction.", notFound: true };
  }
  const raw = await fsPromises.readFile(normalizedPath, "utf-8");
  // Strip JS-style comments before parsing — handles dirty JSON files
  const cleaned = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return JSON.parse(cleaned);
}

/* ── Public HTTPS URL ── */
async function getPublicUrlTranscription(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch transcription from URL: ${res.status} ${res.statusText}`);
  const raw = await res.text();
  const cleaned = raw.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return JSON.parse(cleaned);
}
