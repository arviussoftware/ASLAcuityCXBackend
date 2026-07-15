// import crypto from "crypto";
// import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

// const licenseBucket = (process.env.BUCKET || "").trim();
// const licenseFileKey = (process.env.LICENSE_FILE_KEY || "license.lic").trim();

// const s3 = new S3Client({
//   region: process.env.REGION,
//   credentials: {
//     accessKeyId: process.env.Amazon_ACCESS_KEY_ID,
//     secretAccessKey: process.env.Amazon_SECRET_ACCESS_KEY,
//   },
// });

// async function streamToBuffer(stream) {
//   const chunks = [];

//   for await (const chunk of stream) {
//     chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
//   }

//   return Buffer.concat(chunks);
// }

// async function getLicenseBufferFromS3() {
//   if (!licenseBucket) {
//     throw new Error("BUCKET not configured");
//   }

//   const response = await s3.send(
//     new GetObjectCommand({
//       Bucket: licenseBucket,
//       Key: licenseFileKey,
//     }),
//   );

//   return await streamToBuffer(response.Body);
// }

// function normalizePublicKey(publicKeyRaw) {
//   const value = publicKeyRaw.replace(/\\n/g, "\n").trim();

//   if (value.includes("BEGIN PUBLIC KEY")) {
//     return value;
//   }

//   return `-----BEGIN PUBLIC KEY-----\n${value}\n-----END PUBLIC KEY-----`;
// }

// export function decryptLicenseBuffer(buffer) {
//   const publicKeyRaw = process.env.LICENSE_PUBLIC_KEY;

//   if (!publicKeyRaw) {
//     throw new Error("LICENSE_PUBLIC_KEY not configured");
//   }

//   const publicKey = normalizePublicKey(publicKeyRaw);

//   const encryptedAesKey = buffer.slice(0, 256);
//   const iv = buffer.slice(256, 272);
//   const ciphertext = buffer.slice(272);

//   const aesKey = crypto.publicDecrypt(
//     {
//       key: publicKey,
//       padding: crypto.constants.RSA_PKCS1_PADDING,
//     },
//     encryptedAesKey,
//   );

//   const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);

//   let decrypted = decipher.update(ciphertext, undefined, "utf8");
//   decrypted += decipher.final("utf8");

//   return decrypted;
// }

// export function parseLicenseFromEncryptedBase64(base64) {
//   const raw = Buffer.from(base64, "base64");
//   const json = decryptLicenseBuffer(raw);

//   return JSON.parse(json);
// }

// export function saveLicenseObject() {
//   throw new Error("saveLicenseObject is disabled. License is managed from S3.");
// }

// export async function getStoredLicense() {
//   try {
//     const rawBuffer = await getLicenseBufferFromS3();
//     const json = decryptLicenseBuffer(rawBuffer);

//     return JSON.parse(json);
//   } catch (error) {
//     console.error("Failed to read license from S3:", error.message || error);
//     return null;
//   }
// }

// export async function isLicenseExpired(licenseObj) {
//   const lic = licenseObj || (await getStoredLicense());

//   if (!lic) return true;

//   if (Array.isArray(lic.modules)) {
//     return (await getActiveModuleIds(lic)).length === 0;
//   }

//   if (!lic.expiryDate) return true;

//   const expiry = new Date(lic.expiryDate);

//   if (Number.isNaN(expiry.getTime())) return true;

//   return expiry < new Date();
// }

// export async function getActiveModuleIds(licenseObj) {
//   const lic = licenseObj || (await getStoredLicense());

//   if (!lic) return [];

//   if (Array.isArray(lic.modules)) {
//     const now = new Date();

//     return lic.modules.reduce((acc, m) => {
//       const id = Number(m.moduleId ?? m.id ?? m.module);

//       if (Number.isNaN(id)) return acc;

//       if (m.expiryDate) {
//         const exp = new Date(m.expiryDate);

//         if (Number.isNaN(exp.getTime())) return acc;

//         exp.setHours(23, 59, 59, 999);

//         if (exp < now) return acc;
//       }

//       acc.push(id);
//       return acc;
//     }, []);
//   }

//   if (Array.isArray(lic.allowedModules)) {
//     if (lic.expiryDate) {
//       const overall = new Date(lic.expiryDate);

//       if (Number.isNaN(overall.getTime())) return [];
//       if (overall < new Date()) return [];
//     }

//     return lic.allowedModules.map(Number);
//   }

//   return [];
// }

// export async function isModuleLicensed(moduleId) {
//   const active = await getActiveModuleIds();

//   return active.map(Number).includes(Number(moduleId));
// }

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const licenseBucket = (process.env.BUCKET || "").trim();
const licenseFileKey = (process.env.LICENSE_FILE_KEY || "license.lic").trim();
const licenseDir = (process.env.LICENSE_DIR || "").trim(); // optional

const s3 = new S3Client({
  region: process.env.REGION,
  credentials: {
    accessKeyId: process.env.Amazon_ACCESS_KEY_ID,
    secretAccessKey: process.env.Amazon_SECRET_ACCESS_KEY,
  },
});

function buildCandidates(filename) {
  const candidates = [];

  if (licenseDir) {
    candidates.push(path.join(licenseDir, filename));
  }

  candidates.push(
    path.resolve(process.cwd(), filename),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), filename),
    path.join("/etc/license", filename),
    path.join("/opt/license", filename),
  );

  return candidates;
}

function resolveLocalLicPath() {
  for (const candidate of buildCandidates(path.basename(licenseFileKey))) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ─── Buffer readers ───────────────────────────────────────────────────────────

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function getLicenseBufferFromS3() {
  if (!licenseBucket) throw new Error("BUCKET not configured");

  const response = await s3.send(
    new GetObjectCommand({ Bucket: licenseBucket, Key: licenseFileKey }),
  );
  return await streamToBuffer(response.Body);
}

async function getLicenseBuffer() {
  const localPath = resolveLocalLicPath();

  if (localPath) {
    console.log(`Reading license from local file: ${localPath}`);
    return fs.readFileSync(localPath);
  }

  console.log("Local license.lic not found. Reading from S3...");
  return await getLicenseBufferFromS3();
}

// ─── Decryption ───────────────────────────────────────────────────────────────

function normalizePublicKey(publicKeyRaw) {
  const value = publicKeyRaw.replace(/\\n/g, "\n").trim();
  if (value.includes("BEGIN PUBLIC KEY")) return value;
  return `-----BEGIN PUBLIC KEY-----\n${value}\n-----END PUBLIC KEY-----`;
}

export function decryptLicenseBuffer(buffer) {
  const publicKeyRaw = process.env.LICENSE_PUBLIC_KEY;
  if (!publicKeyRaw) throw new Error("LICENSE_PUBLIC_KEY not configured");

  const publicKey = normalizePublicKey(publicKeyRaw);

  const encryptedAesKey = buffer.slice(0, 256);
  const iv = buffer.slice(256, 272);
  const ciphertext = buffer.slice(272);

  const aesKey = crypto.publicDecrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    encryptedAesKey,
  );

  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  let decrypted = decipher.update(ciphertext, undefined, "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function parseLicenseFromEncryptedBase64(base64) {
  const raw = Buffer.from(base64, "base64");
  const json = decryptLicenseBuffer(raw);
  return JSON.parse(json);
}

export function saveLicenseObject() {
  throw new Error(
    "saveLicenseObject is disabled. License is managed from S3 or local file.",
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

let cachedLicense = null;
let lastFetchTime = 0;
const CACHE_TTL = 60 * 1000; // Cache license for 1 minute

export async function getStoredLicense() {
  const now = Date.now();
  if (cachedLicense && (now - lastFetchTime < CACHE_TTL)) {
    return cachedLicense;
  }
  try {
    const rawBuffer = await getLicenseBuffer();
    const json = decryptLicenseBuffer(rawBuffer);
    cachedLicense = JSON.parse(json);
    lastFetchTime = now;
    return cachedLicense;
  } catch (error) {
    console.error("Failed to read license:", error.message || error);
    return null;
  }
}

export async function isLicenseExpired(licenseObj) {
  const lic = licenseObj || (await getStoredLicense());
  if (!lic) return true;

  if (Array.isArray(lic.modules)) {
    return (await getActiveModuleIds(lic)).length === 0;
  }

  if (!lic.expiryDate) return true;

  const expiry = new Date(lic.expiryDate);
  if (Number.isNaN(expiry.getTime())) return true;

  return expiry < new Date();
}

export async function getActiveModuleIds(licenseObj) {
  const lic = licenseObj || (await getStoredLicense());
  if (!lic) return [];

  if (Array.isArray(lic.modules)) {
    const now = new Date();
    return lic.modules.reduce((acc, m) => {
      const id = Number(m.moduleId ?? m.id ?? m.module);
      if (Number.isNaN(id)) return acc;

      if (m.expiryDate) {
        const exp = new Date(m.expiryDate);
        if (Number.isNaN(exp.getTime())) return acc;
        exp.setHours(23, 59, 59, 999);
        if (exp < now) return acc;
      }

      acc.push(id);
      return acc;
    }, []);
  }

  if (Array.isArray(lic.allowedModules)) {
    if (lic.expiryDate) {
      const overall = new Date(lic.expiryDate);
      if (Number.isNaN(overall.getTime())) return [];
      if (overall < new Date()) return [];
    }
    return lic.allowedModules.map(Number);
  }

  return [];
}

export async function isModuleLicensed(moduleId) {
  const active = await getActiveModuleIds();
  return active.map(Number).includes(Number(moduleId));
}
