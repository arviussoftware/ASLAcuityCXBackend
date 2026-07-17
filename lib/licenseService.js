// import crypto from "crypto";
// import fs from "fs";
// import path from "path";
// import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

// const licenseBucket = (process.env.BUCKET || "").trim();
// const licenseFileKey = (process.env.LICENSE_FILE_KEY || "license.lic").trim();
// const licenseDir = (process.env.LICENSE_DIR || "").trim(); // optional

// const s3 = new S3Client({
//   region: process.env.REGION,
//   credentials: {
//     accessKeyId: process.env.Amazon_ACCESS_KEY_ID,
//     secretAccessKey: process.env.Amazon_SECRET_ACCESS_KEY,
//   },
// });

// function buildCandidates(filename) {
//   const candidates = [];

//   if (licenseDir) {
//     candidates.push(path.join(licenseDir, filename));
//   }

//   candidates.push(
//     path.resolve(process.cwd(), filename),
//     path.resolve(path.dirname(new URL(import.meta.url).pathname), filename),
//     path.join("/etc/license", filename),
//     path.join("/opt/license", filename),
//   );

//   return candidates;
// }

// function resolveLocalLicPath() {
//   for (const candidate of buildCandidates(path.basename(licenseFileKey))) {
//     if (fs.existsSync(candidate)) return candidate;
//   }
//   return null;
// }

// // ─── Buffer readers ───────────────────────────────────────────────────────────

// async function streamToBuffer(stream) {
//   const chunks = [];
//   for await (const chunk of stream) {
//     chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
//   }
//   return Buffer.concat(chunks);
// }

// async function getLicenseBufferFromS3() {
//   if (!licenseBucket) throw new Error("BUCKET not configured");

//   const response = await s3.send(
//     new GetObjectCommand({ Bucket: licenseBucket, Key: licenseFileKey }),
//   );
//   return await streamToBuffer(response.Body);
// }

// async function getLicenseBuffer() {
//   const localPath = resolveLocalLicPath();

//   if (localPath) {
//     console.log(`Reading license from local file: ${localPath}`);
//     return fs.readFileSync(localPath);
//   }

//   console.log("Local license.lic not found. Reading from S3...");
//   return await getLicenseBufferFromS3();
// }

// // ─── Decryption ───────────────────────────────────────────────────────────────

// function normalizePublicKey(publicKeyRaw) {
//   const value = publicKeyRaw.replace(/\\n/g, "\n").trim();
//   if (value.includes("BEGIN PUBLIC KEY")) return value;
//   return `-----BEGIN PUBLIC KEY-----\n${value}\n-----END PUBLIC KEY-----`;
// }

// export function decryptLicenseBuffer(buffer) {
//   const publicKeyRaw = process.env.LICENSE_PUBLIC_KEY;
//   if (!publicKeyRaw) throw new Error("LICENSE_PUBLIC_KEY not configured");

//   const publicKey = normalizePublicKey(publicKeyRaw);

//   const encryptedAesKey = buffer.slice(0, 256);
//   const iv = buffer.slice(256, 272);
//   const ciphertext = buffer.slice(272);

//   const aesKey = crypto.publicDecrypt(
//     { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
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
//   throw new Error(
//     "saveLicenseObject is disabled. License is managed from S3 or local file.",
//   );
// }

// // ─── Public API ───────────────────────────────────────────────────────────────

// let cachedLicense = null;
// let lastFetchTime = 0;
// const CACHE_TTL = 60 * 1000; // Cache license for 1 minute

// export async function getStoredLicense() {
//   const now = Date.now();
//   if (cachedLicense && (now - lastFetchTime < CACHE_TTL)) {
//     return cachedLicense;
//   }
//   try {
//     const rawBuffer = await getLicenseBuffer();
//     const json = decryptLicenseBuffer(rawBuffer);
//     cachedLicense = JSON.parse(json);
//     lastFetchTime = now;
//     return cachedLicense;
//   } catch (error) {
//     console.error("Failed to read license:", error.message || error);
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

import fs from "fs";
import path from "path";
import crypto from "crypto";

const STORE_PATH = path.join(process.cwd(), "data");
const STORE_FILE = path.join(STORE_PATH, "license.json");

function ensureStoreDir() {
  try {
    if (!fs.existsSync(STORE_PATH))
      fs.mkdirSync(STORE_PATH, { recursive: true });
  } catch (e) {
    // ignore
  }
}

export function decryptLicenseBuffer(buffer) {
  const publicKeyRaw = process.env.LICENSE_PUBLIC_KEY;
  if (!publicKeyRaw) throw new Error("LICENSE_PUBLIC_KEY not configured");
  const publicKey = publicKeyRaw.replace(/\\n/g, "\n").trim();

  // 1. Extract parts from the envelope: [encrypted AES key (256 bytes) + IV (16 bytes) + ciphertext]
  const encryptedAesKey = buffer.slice(0, 256);
  const iv = buffer.slice(256, 272);
  const ciphertext = buffer.slice(272);

  // 2. Decrypt the AES key using the RSA public key
  const aesKey = crypto.publicDecrypt(publicKey, encryptedAesKey);

  // 3. Decrypt the license body using AES-256-CBC
  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, iv);
  let decrypted = decipher.update(ciphertext, undefined, "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function parseLicenseFromEncryptedBase64(base64) {
  const raw = Buffer.from(base64, "base64");
  const json = decryptLicenseBuffer(raw);
  const obj = JSON.parse(json);
  return obj;
}

export function saveLicenseObject(licenseObj) {
  ensureStoreDir();
  // NOTE: keep this helper for backward compatibility with tooling.
  // It writes the plain JSON to `data/license.json` for offline tools only.
  ensureStoreDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(licenseObj, null, 2), "utf8");
}

export function getStoredLicense() {
  // Runtime: prefer encrypted license file `license.lic` at repository root.
  // If the encrypted file cannot be decoded, fall back to the plain JSON cache
  // so deployments that still rely on the offline generator keep working.
  try {
    const runtimeFile = path.join(process.cwd(), "license.lic");
    if (!fs.existsSync(runtimeFile)) {
      console.warn("license.lic file not found at path:", runtimeFile);
      return null;
    }
    const rawBuffer = fs.readFileSync(runtimeFile);
    const json = decryptLicenseBuffer(rawBuffer);
    return JSON.parse(json);
  } catch (e) {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const fallbackText = fs.readFileSync(STORE_FILE, "utf8");
        return JSON.parse(fallbackText);
      }
    } catch {
      // ignore fallback errors
    }

    console.error("Failed to read runtime license:", e.message || e);
    return null;
  }
}

export function isLicenseExpired(licenseObj) {
  const lic = licenseObj || getStoredLicense();
  if (!lic) return true;

  if (Array.isArray(lic.modules)) {
    return getActiveModuleIds(lic).length === 0;
  }

  if (!lic.expiryDate) return true;

  const expiry = new Date(lic.expiryDate);
  if (Number.isNaN(expiry.getTime())) return true;

  const now = new Date();
  return expiry < now;
}

export function getActiveModuleIds(licenseObj) {
  const lic = licenseObj || getStoredLicense();
  if (!lic) return [];

  // New format: { modules: [ { moduleId, moduleName, expiryDate } ] }
  if (Array.isArray(lic.modules)) {
    const now = new Date();
    return lic.modules.reduce((acc, m) => {
      const id = Number(m.moduleId ?? m.id ?? m.module);
      if (Number.isNaN(id)) return acc;

      // If module entry has expiryDate, ensure it's not expired. If missing, treat as active.
      if (m.expiryDate) {
        const exp = new Date(m.expiryDate);

        if (Number.isNaN(exp.getTime())) return acc;

        // Expire at end of day
        exp.setHours(23, 59, 59, 999);

        if (exp < now) return acc;
      }

      acc.push(id);
      return acc;
    }, []);
  }

  // Backward compatibility: old format { expiryDate, allowedModules: [1,2,3] }
  if (Array.isArray(lic.allowedModules)) {
    // If top-level expiryDate exists, ensure license is not expired
    if (lic.expiryDate) {
      const overall = new Date(lic.expiryDate);
      if (Number.isNaN(overall.getTime())) return [];
      if (overall < new Date()) return [];
    }
    return lic.allowedModules.map(Number);
  }

  return [];
}

export function isModuleLicensed(moduleId) {
  const active = getActiveModuleIds();
  return active.map(Number).includes(Number(moduleId));
}
