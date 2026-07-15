import { S3Client, GetObjectCommand, RestoreObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs";
import path from "path";

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function isNotFoundError(err) {
  const name = String(err?.name ?? "");
  const code = String(err?.Code ?? err?.code ?? "");
  const http = Number(err?.$metadata?.httpStatusCode);
  return name === "NoSuchKey" || code === "NoSuchKey" || http === 404;
}

export function normalizeDestPrefix(prefix) {
  const p = String(prefix ?? "").trim().replace(/\\/g, "/");
  if (!p) return "";
  return p.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function parseS3Url(s3Url) {
  const raw = String(s3Url || "").trim();
  if (!raw.toLowerCase().startsWith("s3://")) return null;
  const without = raw.slice(5);
  const idx = without.indexOf("/");
  if (idx <= 0) return null;
  const bucket = without.slice(0, idx);
  const key = without.slice(idx + 1);
  if (!bucket || !key) return null;
  return { bucket, key };
}

export function normalizeSourceS3(parsed, sourceBucketFallback) {
  if (!parsed) return null;
  const fallback = String(sourceBucketFallback || "").trim();
  if (!fallback) return parsed;
  if (parsed.bucket !== fallback) {
    const b = String(parsed.bucket || "").trim();
    if (b && /^[A-Za-z0-9._-]+$/.test(b) && b.toUpperCase().includes("TEST")) {
      return { bucket: fallback, key: `${b}/${parsed.key}` };
    }
  }
  return parsed;
}

export function basename(key) {
  const s = String(key || "");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

async function handleGlacierObject(s3Client, bucket, key, err) {
  const name = String(err?.name ?? "");
  const code = String(err?.Code ?? err?.code ?? "");
  const msg = String(err?.message ?? "");
  const isGlacier = 
    name === "InvalidObjectState" || 
    code === "InvalidObjectState" || 
    msg.includes("storage class") ||
    msg.includes("Glacier");

  if (isGlacier) {
    let alreadyInProgress = false;
    try {
      console.log(`[s3] Object s3://${bucket}/${key} is in Glacier storage class. Initiating restore request...`);
      const days = Number(process.env.GLACIER_RESTORE_DAYS || 2);
      await s3Client.send(new RestoreObjectCommand({
        Bucket: bucket,
        Key: key,
        RestoreRequest: {
          Days: days,
          GlacierJobParameters: {
            Tier: "Standard",
          },
        },
      }));
      console.log(`[s3] Restore request initiated for s3://${bucket}/${key}.`);
    } catch (restoreErr) {
      if (restoreErr?.name === "RestoreAlreadyInProgress" || restoreErr?.code === "RestoreAlreadyInProgress" || restoreErr?.Code === "RestoreAlreadyInProgress") {
        console.log(`[s3] Restore already in progress for s3://${bucket}/${key}.`);
        alreadyInProgress = true;
      } else {
        console.error(`[s3] Failed to initiate restore for s3://${bucket}/${key}:`, restoreErr?.message || restoreErr);
      }
    }
    
    if (alreadyInProgress) {
      throw new Error(`GlacierObjectRestoreInProgress: Restoration is already in progress for this object in S3 Glacier/Deep Archive. It typically takes 12-48 hours. Once complete, the file will be successfully exported on the next run.`);
    } else {
      throw new Error(`GlacierObjectArchived: The object is archived in S3 Glacier/Deep Archive. A restore request has been initiated (retrieval takes 3-5 hours for Glacier, or 12-48 hours for Deep Archive). Once the restore is complete, the file will be successfully exported on the next run.`);
    }
  }
  
  throw err;
}

export async function copyObject({ sourceS3, destS3, source, dest, contentType, storageClass }) {
  // Try direct S3-to-S3 copy first (extremely fast inside AWS network)
  try {
    const copySource = `/${source.bucket}/${encodeURIComponent(source.key)}`;
    const commandParams = {
      Bucket: dest.bucket,
      Key: dest.key,
      CopySource: copySource,
      StorageClass: storageClass,
    };
    if (contentType) {
      commandParams.ContentType = contentType;
      commandParams.MetadataDirective = "REPLACE";
    }
    await destS3.send(new CopyObjectCommand(commandParams));
    console.log(`[s3] Direct S3-to-S3 copy completed successfully for s3://${source.bucket}/${source.key}`);
    return;
  } catch (directCopyErr) {
    const errName = String(directCopyErr?.name ?? "");
    const errMsg = String(directCopyErr?.message ?? "");
    if (errName === "InvalidObjectState" || errName === "ObjectNotInActiveTierError" || errMsg.includes("storage class") || errMsg.includes("Glacier")) {
      await handleGlacierObject(sourceS3, source.bucket, source.key, directCopyErr);
    }
    console.warn(`[s3] Direct S3 copy failed (${directCopyErr.message || directCopyErr}). Falling back to streaming copy...`);
  }

  let getRes;
  try {
    getRes = await sourceS3.send(new GetObjectCommand({ Bucket: source.bucket, Key: source.key }));
  } catch (err) {
    await handleGlacierObject(sourceS3, source.bucket, source.key, err);
  }
  if (!getRes?.Body) throw new Error("Source object has no body");

  const uploader = new Upload({
    client: destS3,
    params: {
      Bucket: dest.bucket,
      Key: dest.key,
      Body: getRes.Body,
      ContentType: contentType ?? getRes.ContentType ?? undefined,
      StorageClass: storageClass,
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });

  await uploader.done();
}

export async function putObject({ destS3, dest, body, contentType }) {
  const uploader = new Upload({
    client: destS3,
    params: {
      Bucket: dest.bucket,
      Key: dest.key,
      Body: body,
      ContentType: contentType,
    },
    queueSize: 2,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false,
  });
  await uploader.done();
}

export async function getObjectText({ s3, bucket, key, encoding = "utf8" }) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res?.Body) return "";
    const buf = await streamToBuffer(res.Body);
    return buf.toString(encoding);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

export function createS3Client({ region, accessKeyId, secretAccessKey }) {
  const ak = String(accessKeyId || "").trim();
  const sk = String(secretAccessKey || "").trim();

  const base = {
    region,
    maxAttempts: 5,
  };

  if (!ak || !sk) return new S3Client(base);

  return new S3Client({
    ...base,
    credentials: { accessKeyId: ak, secretAccessKey: sk },
  });
}

export async function downloadToLocal({ sourceS3, source, localPath }) {
  let getRes;
  try {
    getRes = await sourceS3.send(new GetObjectCommand({ Bucket: source.bucket, Key: source.key }));
  } catch (err) {
    await handleGlacierObject(sourceS3, source.bucket, source.key, err);
  }
  if (!getRes?.Body) throw new Error("Source object has no body");

  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const writer = fs.createWriteStream(localPath);
  try {
    await new Promise((resolve, reject) => {
      getRes.Body.pipe(writer);
      getRes.Body.on("error", reject);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  } catch (err) {
    writer.destroy();
    try {
      if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    } catch {}
    throw err;
  }
}
