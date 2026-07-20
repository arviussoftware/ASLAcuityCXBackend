// app/api/interactions/downloadSelected/route.js
import { NextResponse } from "next/server";
import archiver from "archiver";
import { Readable } from "stream";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { logAudit } from "@/lib/auditLogger";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Storage } from "@google-cloud/storage";
import { promisify } from "util";
import { exec } from "child_process";
import { getAWSCredentials } from "@/lib/connectionCredentials";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import {
  createJob,
  updateJob,
  completeJob,
  failJob,
  cancelJob,
  isCancelRequested,
} from "@/lib/downloadJobs";
import { sendExportNotificationEmail } from "@/lib/sendExportNotificationEmail";
import {
  readRestoreRecord,
  writeRestoreRecord,
  isGlacierRestoreRequiredError,
  getObjectRestoreStatus,
  initiateObjectRestore,
} from "@/lib/glacierRestoreTracker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const execPromise = promisify(exec);
const MAX_DOWNLOAD_RECORDINGS = Number(process.env.MAX_EXPORT_LIMIT || 2000);
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
const BULK_DOWNLOAD_DIR = path.join(os.tmpdir(), "acuitycx-bulk-downloads");

const NUMERIC_TYPE_MAP = { 1: "network", 2: "local", 3: "aws-s3", 4: "gcp" };
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
  )
    return "gcp";
  if (filePath.startsWith("\\\\") || filePath.startsWith("//"))
    return "network";
  if (filePath.startsWith("https://") || filePath.startsWith("http://"))
    return "public-url";
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
  )
    return true;
  const normalized = path.normalize(filePath);
  if (normalized.includes("..")) return false;
  if (!path.isAbsolute(normalized) && !normalized.startsWith("\\\\"))
    return false;
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

const sanitizeArchiveFileName = (value = "") =>
  String(value || "Interactions.zip")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 180) || "Interactions.zip";

async function createLocalOrNetworkStream(fileLocation, sourceType) {
  if (sourceType === "network") {
    const directoryPath = fileLocation.split("\\");
    const rootDir = `\\\\${directoryPath[2]}\\${directoryPath[3]}`;
    const { stdout: netUseOutput } = await execPromise("net use");
    if (netUseOutput.includes(rootDir)) {
      await execPromise(`net use ${rootDir} /delete`);
    }
    await execPromise(
      `net use ${rootDir} /user:${process.env.NETWORKNAME} ${process.env.NETWORKPASSWORD} /persistent:no`,
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
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
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

const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

export async function POST(req) {
  const requestId = Date.now().toString(36);
  const tagBase = `[DL:${requestId}]`;

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    const loggedInUserId = req.headers.get("loggedInUserId");
    const userName = req.headers.get("userName");
    const body = await req.json();
    const interactions = Array.isArray(body.interactionIds)
      ? body.interactionIds
      : [];
    const archiveFileName = sanitizeArchiveFileName(body.archiveFileName);

    if (interactions.length > MAX_DOWNLOAD_RECORDINGS) {
      return new Response(
        `Too many recordings requested (${interactions.length}). Please narrow your date range or selection so that at most ${MAX_DOWNLOAD_RECORDINGS} calls are included, then try again.`,
        { status: 400 },
      );
    }

    const downloadableInteractions = interactions.filter(
      (i) =>
        i &&
        typeof i === "object" &&
        typeof i.fileLocation === "string" &&
        i.fileLocation.trim(),
    );

    if (!interactions.length)
      return new Response("No interactions", { status: 400 });
    if (!downloadableInteractions.length) {
      return new Response("Selected interactions do not include file paths.", {
        status: 400,
      });
    }

    const creds = await getAWSCredentials();
    const awsAccessKeyId =
      creds.AWS_ACCESS_KEY_ID ||
      creds.Amazon_ACCESS_KEY_ID ||
      process.env.AWS_ACCESS_KEY_ID ||
      "";
    const awsSecretAccessKey =
      creds.AWS_SECRET_ACCESS_KEY ||
      creds.Amazon_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY ||
      "";
    const awsRegion = creds.REGION || process.env.REGION || "";



    const jobId = randomUUID();
    const dateRangeLabel = body.dateRangeLabel || "";
    const downloadType = body.downloadType || "all";
    const totalMatching = Number(
      body.totalMatching || downloadableInteractions.length,
    );

    createJob(jobId, {
      total: downloadableInteractions.length,
      archiveFileName,
      dateRangeLabel,
      downloadType,
    });

    runBulkDownloadJob({
      jobId,
      tagBase,
      downloadableInteractions,
      archiveFileName,
      creds,
      awsAccessKeyId,
      awsSecretAccessKey,
      awsRegion,
      loggedInUserId,
      userName,
      userEmail: body.userEmail || "",
      dateRangeLabel,
      totalMatching,
      downloadType,
    }).catch((err) => {
      console.error(`${tagBase} job runner crashed:`, err);
      failJob(jobId, err);
    });

    await logSuccess(
      "POST /api/interactions/downloadSelected",
      "Bulk download job started.",
      {
        jobId,
        loggedInUserId,
        requestedCount: downloadableInteractions.length,
        archiveFileName,
      },
    );

    return NextResponse.json({ jobId }, { status: 202 });
  } catch (error) {
    console.error(`${tagBase} UNHANDLED error starting job:`, error);
    await logError("POST /api/interactions/downloadSelected", error); // add await
    return new Response(
      `Internal Server Error: ${error?.message || String(error)}`, // temporarily surface it
      { status: 500 },
    );
  }
}

async function runBulkDownloadJob({
  jobId,
  tagBase,
  downloadableInteractions,
  archiveFileName,
  creds,
  awsAccessKeyId,
  awsSecretAccessKey,
  awsRegion,
  loggedInUserId,
  userName,
  userEmail,
  dateRangeLabel,
  totalMatching,
  downloadType,
}) {
  fs.mkdirSync(BULK_DOWNLOAD_DIR, { recursive: true });
  const diskStreamPath = path.join(BULK_DOWNLOAD_DIR, archiveFileName);

  const archive = archiver("zip", { zlib: { level: 0 } });
  const diskStream = fs.createWriteStream(diskStreamPath);
  const diskStreamFinished = new Promise((resolve, reject) => {
    diskStream.once("finish", resolve);
    diskStream.once("error", reject);
  });
  archive.pipe(diskStream);
  archive.on("error", (err) => console.error(`${tagBase} ARCHIVE ERROR:`, err));
  archive.on("warning", (err) =>
    console.warn(`${tagBase} archive warning:`, err),
  );

  let s3 = null;
  let gcs = null;
  const getS3Client = () => {
    if (!s3) {
      const s3Config = {
        region: awsRegion,
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
        throw new Error(
          "GCP storage is not configured. Set GCP_PROJECT_ID and GCP_KEY_FILE.",
        );
      }
      gcs = new Storage({ projectId, keyFilename });
    }
    return gcs;
  };

  let appendedCount = 0;
  let failedCount = 0;
  const failedCallIds = [];
  let notRetrievedCount = 0;
  const notRetrievedCallIds = [];

  const appendFile = async (interaction, index) => {
    const { fileLocation, fileSourceType, callId } = interaction;
    const interactionId =
      interaction.interactionId ??
      interaction.interaction_id ??
      interaction.id ??
      null;
    const tag = `${tagBase}[#${index}:${callId || "unknown"}]`;
    if (!fileLocation) return;

    const ext = getFileExtension(fileLocation);
    const resolvedSourceType = resolveSourceType(fileSourceType, fileLocation);
    const safeCallId = callId || "unknown";

    try {
      if (resolvedSourceType === "aws-s3" && interactionId) {
        const record = await readRestoreRecord({
          interactionId,
          filePath: fileLocation,
        });
        let trackedStatus = String(
          record?.Status ?? record?.status ?? "",
        ).toUpperCase();

        if (trackedStatus && trackedStatus !== "RETRIEVED") {
          if (
            trackedStatus === "IN_PROGRESS" ||
            trackedStatus === "INITIATED"
          ) {
            try {
              const actualS3Status = await getObjectRestoreStatus({
                filePath: fileLocation,
                fileSourceType: "aws-s3",
              });
              if (actualS3Status?.status === "retrieved") {
                await writeRestoreRecord({
                  interactionId,
                  filePath: fileLocation,
                  status: "retrieved",
                });
                trackedStatus = "RETRIEVED";
              }
            } catch (err) {
              console.error(
                `${tag} Failed to check S3 restore status:`,
                err.message,
              );
            }
          }
          if (trackedStatus !== "RETRIEVED") {
            if (trackedStatus !== "IN_PROGRESS" && trackedStatus !== "INITIATED") {
              try {
                await initiateObjectRestore({
                  interactionId,
                  filePath: fileLocation,
                  fileSourceType: "aws-s3",
                  createdBy: loggedInUserId,
                });
              } catch (restoreErr) {
                await logWarning(
                  "POST /api/interactions/downloadSelected",
                  `Failed to initiate restore for ${safeCallId}.`,
                  { error: restoreErr?.message || String(restoreErr) },
                );
              }
            }
            notRetrievedCount++;
            notRetrievedCallIds.push(safeCallId);
            return;
          }
        }
      }

      let fileStream;
      if (resolvedSourceType === "aws-s3") {
        fileStream = await createS3Stream(getS3Client(), fileLocation, creds);
      } else if (resolvedSourceType === "gcp") {
        fileStream = await createGcsStream(getGcsClient(), fileLocation);
      } else if (resolvedSourceType === "public-url") {
        fileStream = await createPublicUrlStream(fileLocation);
      } else {
        if (!validateFilePath(fileLocation)) {
          failedCount++;
          failedCallIds.push(safeCallId);
          return;
        }
        fileStream = await createLocalOrNetworkStream(
          fileLocation,
          resolvedSourceType,
        );
      }

      const fileBuffer = await streamToBuffer(fileStream);
      if (!fileBuffer || fileBuffer.length === 0) {
        failedCount++;
        failedCallIds.push(safeCallId);
        return;
      }

      archive.append(fileBuffer, { name: `interaction_${safeCallId}${ext}` });
      appendedCount++;

      if (resolvedSourceType === "aws-s3" && interactionId) {
        writeRestoreRecord({
          interactionId,
          filePath: fileLocation,
          status: "retrieved",
        }).catch((statusErr) =>
          logWarning(
            "POST /api/interactions/downloadSelected",
            `Downloaded ${safeCallId}, but failed to update Glacier status.`,
            { error: statusErr?.message || String(statusErr) },
          ),
        );
      }
    } catch (err) {
      if (isGlacierRestoreRequiredError(err)) {
        if (interactionId && resolvedSourceType === "aws-s3") {
          try {
            await initiateObjectRestore({
              interactionId,
              filePath: fileLocation,
              fileSourceType: "aws-s3",
              createdBy: loggedInUserId,
            });
          } catch (restoreErr) {
            await logWarning(
              "POST /api/interactions/downloadSelected",
              `Failed to initiate restore for ${safeCallId}.`,
              { error: restoreErr?.message || String(restoreErr) },
            );
          }
        }
        notRetrievedCount++;
        notRetrievedCallIds.push(safeCallId);
      } else {
        failedCount++;
        failedCallIds.push(safeCallId);
        logWarning(
          "POST /api/interactions/downloadSelected",
          `Skipping failed file: ${safeCallId} (${resolvedSourceType})`,
          { error: err?.message || String(err) },
        );
      }
    } finally {
      updateJob(jobId, {
        processed: appendedCount,
        failed: failedCount,
        notRetrieved: notRetrievedCount,
      });
    }
  };

  const MAX_CONCURRENT = 5;
  for (let i = 0; i < downloadableInteractions.length; i += MAX_CONCURRENT) {
    if (isCancelRequested(jobId)) break;
    const chunk = downloadableInteractions.slice(i, i + MAX_CONCURRENT);
    await Promise.all(
      chunk.map((interaction, idx) => appendFile(interaction, i + idx)),
    );
  }

  if (isCancelRequested(jobId)) {
    if (appendedCount === 0) {
      try {
        archive.unpipe(diskStream);
        archive.destroy?.();
      } catch {}
      await new Promise((resolve) => {
        if (diskStream.destroyed) return resolve();
        diskStream.once("close", resolve);
        diskStream.destroy();
      });
      try {
        await fs.promises.unlink(diskStreamPath);
      } catch {}
      cancelJob(jobId, { processed: 0, failed: failedCount });
      return;
    }

    await archive.finalize();
    await diskStreamFinished;
    const fileStats = fs.statSync(diskStreamPath);

    if (loggedInUserId) {
      await logAudit({
        userId: loggedInUserId,
        userName,
        actionType: "BULK_DOWNLOAD_CANCELLED",
        description: `Cancelled after downloading ${appendedCount} of ${downloadableInteractions.length} recordings`,
      });
    }

    cancelJob(jobId, {
      processed: appendedCount,
      failed: failedCount,
      fileSizeBytes: fileStats.size,
      filePath: diskStreamPath,
    });
    return;
  }

  if (appendedCount === 0) {
    updateJob(jobId, {
      processed: 0,
      failed: failedCount,
      notRetrieved: notRetrievedCount,
    });

    if (notRetrievedCount > 0) {
      try {
        await sendExportNotificationEmail({
          userEmail,
          userName,
          downloadCount: 0,
          notRetrievedCount,
          dateRangeLabel,
          archiveFileName,
          totalMatching,
          downloadType,
          notificationType: "restoration",
        });
      } catch (err) {
        console.error(`${tagBase} failed to send restoration email:`, err);
        await logError("downloadSelected -> sendExportNotificationEmail", err);
      }
    }

    try {
      archive.unpipe(diskStream);
      archive.destroy?.();
    } catch {}
    await new Promise((resolve) => {
      if (diskStream.destroyed) return resolve();
      diskStream.once("close", resolve);
      diskStream.destroy();
    });
    try {
      await fs.promises.unlink(diskStreamPath);
    } catch {}

    failJob(
      jobId,
      new Error(
        notRetrievedCount > 0
          ? "Selected recordings are under restoration. Please try again after 12 to 48 hours."
          : "None of the selected recordings could be retrieved.",
      ),
    );
    return;
  }

  await archive.finalize();
  await diskStreamFinished;
  const fileStats = fs.statSync(diskStreamPath);

  if (loggedInUserId) {
    await logAudit({
      userId: loggedInUserId,
      userName,
      actionType: "BULK_DOWNLOAD",
      description: `Downloaded ${appendedCount} of ${downloadableInteractions.length} recordings`,
    });
  }

  completeJob(jobId, {
    processed: appendedCount,
    failed: failedCount,
    notRetrieved: notRetrievedCount,
    fileSizeBytes: fileStats.size,
    filePath: diskStreamPath,
  });

  await logSuccess(
    "POST /api/interactions/downloadSelected",
    "Bulk download job completed successfully.",
    {
      jobId,
      loggedInUserId,
      appended: appendedCount,
      failed: failedCount,
      fileSizeBytes: fileStats.size,
    },
  );

  try {
    await sendExportNotificationEmail({
      userEmail,
      userName,
      downloadCount: appendedCount,
      notRetrievedCount,
      dateRangeLabel,
      archiveFileName,
      totalMatching,
      downloadType,
      notificationType: "downloaded",
    });
  } catch (err) {
    console.error(`${tagBase} failed to send notification email:`, err);
    await logError("downloadSelected -> sendExportNotificationEmail", err);
  }
}
