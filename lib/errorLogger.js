import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.REGION,
  credentials: {
    accessKeyId: process.env.Amazon_ACCESS_KEY_ID,
    secretAccessKey: process.env.Amazon_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.BUCKET;
const LOG_FOLDER = process.env.ASL_LogFolder || "errorlog";

function getS3Key() {
  const now = new Date();
  const day = now.getDate();
  const monthName = now.toLocaleString("en-US", { month: "long" });
  const year = now.getFullYear();
  const fileName = `${day}${monthName}${year}.txt`;
  return `${LOG_FOLDER}/${fileName}`;
}

function formatLogEntry(level, context, message, stack, details) {
  const now = new Date();
  const timestamp = now.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const safeDetails =
    details && Object.keys(details).length > 0
      ? `\nDetails: ${JSON.stringify(details)}`
      : "";

  return (
    `[${timestamp}] [${level}] [${context}]\n` +
    `Message: ${message}\n` +
    `Stack: ${stack || "No stack trace"}${safeDetails}\n` +
    `${"-".repeat(60)}\n`
  );
}

async function writeLogEntry(level, context, message, stack, details) {
  try {
    const key = getS3Key();
    const newEntry = formatLogEntry(level, context, message, stack, details);

    // Try to fetch existing file content first
    let existingContent = "";
    try {
      const getRes = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      );
      existingContent = await getRes.Body.transformToString("utf-8");
    } catch (err) {
      // File doesn't exist yet for today — start fresh
      if (err.name !== "NoSuchKey") throw err;
    }

    // Append new entry and upload
    const updatedContent = existingContent + newEntry;
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: updatedContent,
        ContentType: "text/plain",
      }),
    );
  } catch (s3Err) {
    console.error("Failed to write log to S3:", s3Err);
  }
}

export async function logError(context, error, details = {}) {
  try {
    const message = error?.message || String(error);
    const stack = error?.stack || "No stack trace";
    console.error(`[ERROR] [${context}] ${message}`, details);
    writeLogEntry("ERROR", context, message, stack, details).catch((err) => {
      console.error("Background S3 log write failed:", err);
    });
  } catch (logErr) {
    console.error("Failed to write to error log:", logErr);
  }
}

export async function logWarning(context, warning, details = {}) {
  try {
    const message = warning?.message || String(warning);
    const stack = warning?.stack || "No stack trace";
    console.warn(`[WARN] [${context}] ${message}`, details);
    writeLogEntry("WARN", context, message, stack, details).catch((err) => {
      console.error("Background S3 log write failed:", err);
    });
  } catch (logErr) {
    console.error("Failed to write to warning log:", logErr);
  }
}

export async function logSuccess(context, message, details = {}) {
  try {
    const successMessage = message?.message || String(message);
    const stack = message?.stack || "No stack trace";
    console.info(`[SUCCESS] [${context}] ${successMessage}`, details);
    writeLogEntry("SUCCESS", context, successMessage, stack, details).catch((err) => {
      console.error("Background S3 log write failed:", err);
    });
  } catch (logErr) {
    console.error("Failed to write to success log:", logErr);
  }
}
