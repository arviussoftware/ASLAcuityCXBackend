// app/api/interactions/downloadSelected/route.js
import { NextResponse } from "next/server";
import archiver from "archiver";
import { Readable } from "stream";
import fs from "fs";
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
  resolveSourceType as resolveGlacierSourceType,
  isGlacierRestoreRequiredError,
} from "@/lib/glacierRestoreTracker";

export const maxDuration = 300;
const execPromise = promisify(exec);
const MAX_DOWNLOAD_RECORDINGS = Number(process.env.MAX_EXPORT_LIMIT || 2000);
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
const BULK_DOWNLOAD_DIR =
  process.env.BULK_DOWNLOAD_PATH || "C:\\interaction_download";

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

async function createLocalOrNetworkStream(fileLocation, sourceType, tag) {
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

async function createS3Stream(s3, fileLocation, creds, tag) {
  let bucket = creds.BUCKET;
  let key = fileLocation;

  if (fileLocation.startsWith("s3://")) {
    const withoutPrefix = fileLocation.slice(5);
    const slashIdx = withoutPrefix.indexOf("/");
    bucket = withoutPrefix.slice(0, slashIdx);
    key = withoutPrefix.slice(slashIdx + 1);
  }

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(command);
  return response.Body;
}

async function createGcsStream(gcs, fileLocation, tag) {
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

async function createPublicUrlStream(fileLocation, tag) {
  const response = await fetch(fileLocation);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch public URL: ${response.status}`);
  }
  return Readable.fromWeb(response.body);
}

const streamToBuffer = (stream, tag) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
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
      : Array.isArray(body.interactions)
        ? body.interactions
        : [];
    const archiveFileName = sanitizeArchiveFileName(body.archiveFileName);

    // const downloadInteractions = interactions.slice(0, MAX_DOWNLOAD_RECORDINGS);
    if (interactions.length > MAX_DOWNLOAD_RECORDINGS) {
      return new Response(
        `Too many recordings requested (${interactions.length}). Please narrow your date range or selection so that at most ${MAX_DOWNLOAD_RECORDINGS} calls are included, then try again.`,
        { status: 400 },
      );
    }

    const downloadInteractions = interactions;
    const downloadableInteractions = downloadInteractions.filter(
      (interaction) =>
        interaction &&
        typeof interaction === "object" &&
        typeof interaction.fileLocation === "string" &&
        interaction.fileLocation.trim().length > 0,
    );

    if (!downloadInteractions.length) {
      return new Response("No interactions", { status: 400 });
    }
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
      process.env.Amazon_ACCESS_KEY_ID ||
      "";
    const awsSecretAccessKey =
      creds.AWS_SECRET_ACCESS_KEY ||
      creds.Amazon_SECRET_ACCESS_KEY ||
      process.env.AWS_SECRET_ACCESS_KEY ||
      process.env.Amazon_SECRET_ACCESS_KEY ||
      "";
    const awsRegion = creds.REGION || process.env.REGION || "";

    const hasS3Files = downloadableInteractions.some(
      (i) => resolveSourceType(i.fileSourceType, i.fileLocation) === "aws-s3",
    );

    if (hasS3Files && (!awsAccessKeyId || !awsSecretAccessKey)) {
      return new Response(
        "Storage credentials for S3 recordings are not configured correctly. Contact admin.",
        { status: 500 },
      );
    }

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

    // Fire-and-forget — the response below returns immediately, the actual
    // archive build happens after, decoupled from this request's lifetime.
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
    logError("POST /api/interactions/downloadSelected", error);
    return new Response("Internal Server Error", { status: 500 });
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
  console.log(`${tagBase} building zip at: ${diskStreamPath}`);

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
      s3 = new S3Client({
        region: awsRegion,
        credentials: {
          accessKeyId: awsAccessKeyId,
          secretAccessKey: awsSecretAccessKey,
        },
      });
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
      // Cheap pre-check: if our own restore-tracking table already says this
      // S3 object hasn't finished coming back from Glacier, skip it without
      // spending an S3 GetObject call that we know will fail.
      if (resolvedSourceType === "aws-s3" && interactionId) {
        const record = await readRestoreRecord({
          interactionId,
          filePath: fileLocation,
        });
        const trackedStatus = String(
          record?.Status ?? record?.status ?? "",
        ).toUpperCase();
        if (trackedStatus && trackedStatus !== "RETRIEVED") {
          notRetrievedCount++;
          notRetrievedCallIds.push(safeCallId);
          console.log(`${tag} SKIPPED — Glacier status is "${trackedStatus}"`);
          return;
        }
      }

      let fileStream;
      if (resolvedSourceType === "aws-s3") {
        fileStream = await createS3Stream(
          getS3Client(),
          fileLocation,
          creds,
          tag,
        );
      } else if (resolvedSourceType === "gcp") {
        fileStream = await createGcsStream(getGcsClient(), fileLocation, tag);
      } else if (resolvedSourceType === "public-url") {
        fileStream = await createPublicUrlStream(fileLocation, tag);
      } else {
        if (!validateFilePath(fileLocation)) {
          failedCount++;
          failedCallIds.push(safeCallId);
          return;
        }
        fileStream = await createLocalOrNetworkStream(
          fileLocation,
          resolvedSourceType,
          tag,
        );
      }

      const fileBuffer = await streamToBuffer(fileStream, tag);
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
        // DB said "retrieved" (or had no record) but S3 disagrees — trust S3.
        notRetrievedCount++;
        notRetrievedCallIds.push(safeCallId);
        console.warn(
          `${tag} not yet restored from Glacier (caught at S3 call)`,
        );
      } else {
        failedCount++;
        failedCallIds.push(safeCallId);
        console.error(
          `${tag} FAILED (${resolvedSourceType}):`,
          err?.message || err,
        );
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
    if (isCancelRequested(jobId)) {
      console.log(
        `${tagBase} cancellation requested — stopping before next batch`,
      );
      break;
    }

    const chunk = downloadableInteractions.slice(i, i + MAX_CONCURRENT);
    await Promise.all(
      chunk.map((interaction, idx) => appendFile(interaction, i + idx)),
    );
  }

  console.log(`${tagBase} appended=${appendedCount} failed=${failedCount}`);
  if (failedCount > 0)
    console.warn(`${tagBase} failed callIds:`, failedCallIds);

  if (isCancelRequested(jobId)) {
    if (appendedCount === 0) {
      // Nothing got appended yet — nothing worth keeping, clean up as before.
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
      } catch (err) {
        console.warn(`${tagBase} failed to remove partial zip:`, err.message);
      }

      console.log(`${tagBase} job cancelled by user (processed=0)`);
      cancelJob(jobId, { processed: 0, failed: failedCount });
      return;
    }

    // Finalize so the zip's central directory actually gets written — this is
    // what makes the file openable. Just "not deleting" without finalizing
    // would still leave a corrupt zip.
    console.log(
      `${tagBase} cancellation requested — finalizing partial zip with ${appendedCount} file(s)`,
    );

    await archive.finalize();
    await diskStreamFinished;

    const fileStats = fs.statSync(diskStreamPath);
    console.log(
      `${tagBase} job cancelled — partial zip kept: ${diskStreamPath} (${fileStats.size} bytes, processed=${appendedCount})`,
    );

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
    failJob(
      jobId,
      new Error("None of the selected recordings could be retrieved."),
    );
    return;
  }

  await archive.finalize();
  await diskStreamFinished;

  const fileStats = fs.statSync(diskStreamPath);
  console.log(
    `${tagBase} zip fully written to disk: ${diskStreamPath} (${fileStats.size} bytes)`,
  );

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
      capped: totalMatching > MAX_DOWNLOAD_RECORDINGS,
      dateRangeLabel,
      archiveFileName,
      totalMatching,
      downloadType,
    });
  } catch (err) {
    console.error(`${tagBase} failed to send notification email:`, err);
    await logError("downloadSelected -> sendExportNotificationEmail", err);
  }
}
