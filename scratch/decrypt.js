import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALGORITHM = "aes-256-cbc";

// Load dotenv
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const lines = envContent.split("\n");
  for (const line of lines) {
    const parts = line.split("=");
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const val = parts.slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
      process.env[key] = val;
    }
  }
}

const KEY_MATERIAL = process.env.API_SECRET_KEY;
if (!KEY_MATERIAL) {
  console.error("Error: API_SECRET_KEY is not defined in .env file.");
  process.exit(1);
}

const key = crypto.createHash("sha256").update(KEY_MATERIAL).digest();

function decrypt(encryptedText) {
  try {
    const parts = encryptedText.split(":");
    if (parts.length < 2) return encryptedText;
    const iv = Buffer.from(parts.shift(), "hex");
    const encrypted = Buffer.from(parts.join(":"), "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, undefined, "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("Decryption failed:", err.message);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("Usage: node scratch/decrypt.js \"YOUR_ENCRYPTED_TEXT_TO_DECRYPT\"");
  process.exit(1);
}

const encryptedText = args[0];
const decryptedValue = decrypt(encryptedText);
console.log("\n==================================================");
console.log("Decrypted Plain Text Output:");
console.log("==================================================");
console.log(decryptedValue);
console.log("==================================================\n");
