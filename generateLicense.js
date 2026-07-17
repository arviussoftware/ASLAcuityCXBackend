// import "dotenv/config";
// import crypto from "crypto";
// import fs from "fs";
// import path from "path";
// import {
//   S3Client,
//   GetObjectCommand,
//   PutObjectCommand,
// } from "@aws-sdk/client-s3";

// const bucket = (process.env.BUCKET || "").trim();
// const jsonKey = (process.env.LICENSE_JSON_KEY || "license.json").trim();
// const licKey = (process.env.LICENSE_FILE_KEY || "license.lic").trim();
// const licenseDir = (process.env.LICENSE_DIR || "").trim(); // optional

// const s3 = new S3Client({
//   region: process.env.REGION,
//   credentials: {
//     accessKeyId: process.env.Amazon_ACCESS_KEY_ID,
//     secretAccessKey: process.env.Amazon_SECRET_ACCESS_KEY,
//   },
// });

// const privateKeyRaw = process.env.LICENSE_PRIVATE_KEY;
// if (!privateKeyRaw) {
//   console.error("Error: LICENSE_PRIVATE_KEY is not configured in .env.");
//   process.exit(1);
// }
// const privateKey = privateKeyRaw.replace(/\\n/g, "\n").trim();

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

// function resolveLocalJsonPath() {
//   for (const candidate of buildCandidates(path.basename(jsonKey))) {
//     if (fs.existsSync(candidate)) return candidate;
//   }
//   return null;
// }

// function resolveLocalLicOutputPath() {
//   const filename = path.basename(licKey);
//   const localJson = resolveLocalJsonPath();

//   if (localJson) return path.join(path.dirname(localJson), filename);

//   // Fallback: next to this script
//   return path.resolve(
//     path.dirname(new URL(import.meta.url).pathname),
//     filename,
//   );
// }

// // ─── Readers / writers ────────────────────────────────────────────────────────

// async function streamToBuffer(stream) {
//   const chunks = [];
//   for await (const chunk of stream) {
//     chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
//   }
//   return Buffer.concat(chunks);
// }

// async function getLicenseJson() {
//   const localPath = resolveLocalJsonPath();

//   if (localPath) {
//     console.log(`Reading local file: ${localPath}`);
//     return fs.readFileSync(localPath, "utf8").trim();
//   }

//   if (!bucket) {
//     throw new Error(
//       "license.json not found locally and BUCKET is not configured — cannot fall back to S3.",
//     );
//   }

//   console.log(`Local file not found. Reading s3://${bucket}/${jsonKey}...`);
//   const response = await s3.send(
//     new GetObjectCommand({ Bucket: bucket, Key: jsonKey }),
//   );
//   const buffer = await streamToBuffer(response.Body);
//   return buffer.toString("utf8").trim();
// }

// async function saveLicenseLic(buffer, usedLocal) {
//   if (usedLocal) {
//     const outPath = resolveLocalLicOutputPath();
//     fs.writeFileSync(outPath, buffer);
//     console.log(`Encrypted license saved locally: ${outPath}`);
//     return;
//   }

//   if (!bucket) {
//     throw new Error("BUCKET is not configured — cannot upload to S3.");
//   }

//   await s3.send(
//     new PutObjectCommand({
//       Bucket: bucket,
//       Key: licKey,
//       Body: buffer,
//       ContentType: "application/octet-stream",
//     }),
//   );
//   console.log(`Encrypted license uploaded to s3://${bucket}/${licKey}`);
// }

// // ─── Encryption ───────────────────────────────────────────────────────────────

// function encryptLicenseAsymmetric(plaintext, privateKeyPem) {
//   const aesKey = crypto.randomBytes(32);
//   const iv = crypto.randomBytes(16);

//   const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
//   const encryptedBody = Buffer.concat([
//     cipher.update(plaintext, "utf8"),
//     cipher.final(),
//   ]);

//   const encryptedAesKey = crypto.privateEncrypt(
//     { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_PADDING },
//     aesKey,
//   );

//   return Buffer.concat([encryptedAesKey, iv, encryptedBody]);
// }

// // ─── Main ─────────────────────────────────────────────────────────────────────

// async function main() {
//   try {
//     const localJsonPath = resolveLocalJsonPath();
//     const usedLocal = Boolean(localJsonPath);

//     const payloadText = await getLicenseJson();
//     if (!payloadText) throw new Error("License JSON file is empty.");

//     const payload = JSON.parse(payloadText);

//     const isLegacy =
//       payload?.expiryDate && Array.isArray(payload.allowedModules);
//     const isNew = Array.isArray(payload?.modules);

//     if (!isLegacy && !isNew) {
//       throw new Error(
//         "License JSON must be either { expiryDate, allowedModules } or { modules } format.",
//       );
//     }

//     const encryptedBuffer = encryptLicenseAsymmetric(
//       JSON.stringify(payload),
//       privateKey,
//     );
//     await saveLicenseLic(encryptedBuffer, usedLocal);
//   } catch (error) {
//     console.error(
//       "Failed to generate encrypted license:",
//       error.message || error,
//     );
//     process.exit(1);
//   }
// }

// main();

import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const args = process.argv.slice(2);
const [inputPath, outputPath = "license.lic", keyArg] = args;

if (!inputPath) {
  console.error(
    "Usage: node generateLicense.js <license-json> [output-file] [encryption-key]",
  );
  process.exit(1);
}

const licensePath = path.resolve(process.cwd(), inputPath);
const outPath = path.resolve(process.cwd(), outputPath);

const privateKeyRaw = process.env.LICENSE_PRIVATE_KEY;
if (!privateKeyRaw) {
  console.error("Error: LICENSE_PRIVATE_KEY is not configured in .env.");
  process.exit(1);
}
const privateKey = privateKeyRaw.replace(/\\n/g, "\n").trim();

function encryptLicenseAsymmetric(plaintext, privateKeyPem) {
  // 1. Generate random AES key (32 bytes) and IV (16 bytes)
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);

  // 2. Encrypt plaintext JSON with AES-256-CBC
  const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, iv);
  const encryptedBody = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  // 3. Encrypt the random AES key with RSA Private Key
  const encryptedAesKey = crypto.privateEncrypt(privateKeyPem, aesKey);

  // 4. Combine into final buffer: [encrypted AES key (256 bytes) + IV (16 bytes) + encrypted body]
  return Buffer.concat([encryptedAesKey, iv, encryptedBody]);
}

try {
  const payloadText = fs.readFileSync(licensePath, "utf8").trim();
  if (!payloadText) {
    throw new Error("License JSON file is empty.");
  }

  const payload = JSON.parse(payloadText);

  // Accept either legacy format:
  //  { expiryDate: "...", allowedModules: [1,2,3] }
  // or new format:
  //  { modules: [ { moduleId, moduleName, expiryDate? }, ... ] }
  const isLegacy =
    payload && payload.expiryDate && Array.isArray(payload.allowedModules);
  const isNew = payload && Array.isArray(payload.modules);

  if (!isLegacy && !isNew) {
    throw new Error(
      "License JSON must be either legacy { expiryDate, allowedModules } or new { modules } format.",
    );
  }

  const encryptedBuffer = encryptLicenseAsymmetric(
    JSON.stringify(payload),
    privateKey,
  );

  fs.writeFileSync(outPath, encryptedBuffer);
  console.log(`Encrypted license written to ${outPath}`);
  console.log(
    `To upload, convert to base64 or use the file contents as raw bytes.`,
  );
  console.log(
    `Example base64: node -e "import('fs').then(f => console.log(f.readFileSync('${outPath.replace(/\\/g, "/")}').toString('base64')))"`,
  );
} catch (error) {
  console.error(
    "Failed to generate encrypted license:",
    error.message || error,
  );
  process.exit(1);
}
