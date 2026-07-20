// app/api/interactions/download/route.js

import archiver from "archiver";
import { PassThrough, Readable } from "stream";
import fs from "fs";
import path from "path";
import { logAudit } from "@/lib/auditLogger";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Storage } from "@google-cloud/storage";
import { promisify } from "util";
import { exec } from "child_process";
import { getAWSCredentials } from "@/lib/connectionCredentials";
import { logError, logWarning } from "@/lib/errorLogger";
import { NextResponse } from "next/server";
import mime from "mime-types";

export const maxDuration = 300;
const execPromise = promisify(exec);
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

const NUMERIC_TYPE_MAP = {
  1: "network",
  2: "local",
  3: "aws-s3",
  4: "gcp",
};

const knownSourceTypes = new Set([
  "aws-s3",
  "network",
  "local",
  "gcp",
  "public-url",
]);

const resolveSourceType = (rawSourceType, filePath = "") => {
  const normalized = String(rawSourceType || "")
    .trim()
    .toLowerCase();

  if (filePath.startsWith("gs://")) return "gcp";
  if (filePath.startsWith("s3://")) return "aws-s3";
  if (
    filePath.startsWith("https://storage.googleapis.com/") ||
    filePath.startsWith("https://storage.cloud.google.com/")
  ) {
    return "gcp";
  }
  if (filePath.startsWith("\\\\") || filePath.startsWith("//"))
    return "network";
  if (filePath.startsWith("https://") || filePath.startsWith("http://")) {
    return "public-url";
  }
  if (NUMERIC_TYPE_MAP[normalized]) return NUMERIC_TYPE_MAP[normalized];
  if (knownSourceTypes.has(normalized)) return normalized;

  return "local";
};

function validateFilePath(filePath) {
  if (
    filePath.startsWith("s3://") ||
    filePath.startsWith("gs://") ||
    filePath.startsWith("http://") ||
    filePath.startsWith("https://")
  ) {
    return true;
  }

  const normalized = path.normalize(filePath);
  if (normalized.includes("..")) return false;

  if (!path.isAbsolute(normalized) && !normalized.startsWith("\\\\")) {
    return false;
  }

  return true;
}

const getFileExtension = (fileLocation = "") => {
  try {
    if (
      fileLocation.startsWith("http://") ||
      fileLocation.startsWith("https://")
    ) {
      const url = new URL(fileLocation);
      return path.extname(url.pathname) || ".mp3";
    }
  } catch {}

  return path.extname(fileLocation) || ".mp3";
};

async function createLocalOrNetworkStream(fileLocation, sourceType) {
  if (sourceType === "network") {
    const directoryPath = fileLocation.split("\\");
    const networkUserName = process.env.NETWORKNAME;
    const networkPassword = process.env.NETWORKPASSWORD;
    const rootDir = `\\\\${directoryPath[2]}\\${directoryPath[3]}`;

    const { stdout: netUseOutput } = await execPromise("net use");
    if (netUseOutput.includes(rootDir)) {
      await execPromise(`net use ${rootDir} /delete`);
    }

    await execPromise(
      `net use ${rootDir} /user:${networkUserName} ${networkPassword} /persistent:no`,
    );
  }

  if (!fs.existsSync(fileLocation)) {
    throw new Error(`File not found: ${fileLocation}`);
  }

  return fs.createReadStream(fileLocation);
}

async function createS3Stream(s3, fileLocation, creds) {
  let bucket = creds.BUCKET;
  let key = fileLocation;

  if (fileLocation.startsWith("s3://")) {
    const withoutPrefix = fileLocation.slice(5);
    const slashIdx = withoutPrefix.indexOf("/");
    bucket = withoutPrefix.slice(0, slashIdx);
    key = withoutPrefix.slice(slashIdx + 1);
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await s3.send(command);
  return response.Body;
}

async function createGcsStream(gcs, fileLocation) {
  let bucketName = process.env.GCP_BUCKET;
  let filePath = fileLocation;

  if (fileLocation.startsWith("gs://")) {
    const withoutPrefix = fileLocation.slice(5);
    const slashIdx = withoutPrefix.indexOf("/");
    bucketName = withoutPrefix.slice(0, slashIdx);
    filePath = withoutPrefix.slice(slashIdx + 1);
  } else if (
    fileLocation.startsWith("https://storage.googleapis.com/") ||
    fileLocation.startsWith("https://storage.cloud.google.com/")
  ) {
    const url = new URL(fileLocation);
    const parts = url.pathname.slice(1).split("/");
    bucketName = parts[0];
    filePath = parts.slice(1).join("/");
  }

  return gcs.bucket(bucketName).file(filePath).createReadStream();
}

async function createPublicUrlStream(fileLocation) {
  const response = await fetch(fileLocation);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch public URL: ${response.status}`);
  }

  return Readable.fromWeb(response.body);
}

const appendReadableToArchive = (archive, stream, name) =>
  new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);

    archive.append(stream, { name });
  });

export async function POST(req) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    const loggedInUserId = req.headers.get("loggedInUserId");
    const userName = req.headers.get("userName");
    const body = await req.json();

    const {
      fileLocation,
      fileSourceType,
      transcriptionPath,
      transcriptionSourceType,
      callId,
      fileExtension
    } = body;

    if (!fileLocation || !fileLocation.trim()) {
      return new Response("Missing fileLocation", { status: 400 });
    }

    const safeCallId = callId || "call";
    const ext = fileExtension ? `.${fileExtension.replace(/^\./, "")}` : getFileExtension(fileLocation);

    if (!validateFilePath(fileLocation)) {
      logWarning("POST /api/interactions/download", "Blocked unsafe audio path", { fileLocation });
      return new Response("Forbidden file path", { status: 403 });
    }

    const creds = await getAWSCredentials();
    const awsAccessKeyId = creds.AWS_ACCESS_KEY_ID || creds.Amazon_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || process.env.Amazon_ACCESS_KEY_ID || "";
    const awsSecretAccessKey = creds.AWS_SECRET_ACCESS_KEY || creds.Amazon_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || process.env.Amazon_SECRET_ACCESS_KEY || "";

    let s3 = null;
    let gcs = null;

    const getS3Client = () => {
      if (!s3) {
        const s3Config = {
          region: creds.REGION || process.env.REGION || "",
        };
        if (awsAccessKeyId && awsSecretAccessKey && !awsAccessKeyId.includes("XXX")) {
          s3Config.credentials = { accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey };
        }
        s3 = new S3Client(s3Config);
      }
      return s3;
    };

    const getGcsClient = () => {
      if (!gcs) {
        const projectId = process.env.GCP_PROJECT_ID;
        const keyFilename = process.env.GCP_KEY_FILE;
        if (!projectId || !keyFilename) {
          throw new Error("GCP storage is not configured.");
        }
        gcs = new Storage({ projectId, keyFilename });
      }
      return gcs;
    };

    const getStreamForPath = async (filePath, sourceType) => {
      const resolved = resolveSourceType(sourceType, filePath);
      if (resolved === "aws-s3") {
        return await createS3Stream(getS3Client(), filePath, creds);
      } else if (resolved === "gcp") {
        return await createGcsStream(getGcsClient(), filePath);
      } else if (resolved === "public-url") {
        return await createPublicUrlStream(filePath);
      } else {
        if (!validateFilePath(filePath)) {
          throw new Error("Forbidden file path");
        }
        return await createLocalOrNetworkStream(filePath, resolved);
      }
    };

    const hasTranscription = transcriptionPath && transcriptionPath.trim().length > 0;

    // Log the download action
    if (loggedInUserId) {
      await logAudit({
        userId: loggedInUserId,
        userName,
        actionType: "DOWNLOAD_AUDIO",
        description: `Downloaded call ${safeCallId} ${hasTranscription ? "with transcription" : ""}`,
      });
    }

    if (hasTranscription) {
      if (!validateFilePath(transcriptionPath)) {
        logWarning("POST /api/interactions/download", "Blocked unsafe transcription path", { transcriptionPath });
        return new Response("Forbidden file path", { status: 403 });
      }

      // Create ZIP archive
      const archive = archiver("zip", { zlib: { level: 0 } });
      const stream = new PassThrough();
      archive.pipe(stream);

      archive.on("error", (err) => {
        logError("POST /api/interactions/download archiver", err);
        archive.abort();
      });

      // Run async zipping process
      (async () => {
        try {
          const audioStream = await getStreamForPath(fileLocation, fileSourceType);
          await appendReadableToArchive(archive, audioStream, `${safeCallId}${ext}`);

          try {
            const transStream = await getStreamForPath(transcriptionPath, transcriptionSourceType || fileSourceType);
            await appendReadableToArchive(archive, transStream, `${safeCallId}_transcription.json`);
          } catch (transErr) {
            logWarning("POST /api/interactions/download", "Failed to append transcription to zip", { error: transErr.message });
          }

          await archive.finalize();
        } catch (err) {
          logError("POST /api/interactions/download zip builder", err);
          archive.abort();
        }
      })();

      return new Response(stream, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${safeCallId}.zip"`,
        },
      });
    } else {
      // Just return the audio stream directly
      const audioStream = await getStreamForPath(fileLocation, fileSourceType);
      const mimeType = mime.lookup(ext) || "audio/mpeg";

      return new Response(audioStream, {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${safeCallId}${ext}"`,
        },
      });
    }

  } catch (error) {
    logError("POST /api/interactions/download", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
