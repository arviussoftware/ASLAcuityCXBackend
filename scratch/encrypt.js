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

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("Usage: node scratch/encrypt.js \"YOUR_PLAINTEXT_TO_ENCRYPT\"");
  process.exit(1);
}

const plainText = args[0];
const encryptedValue = encrypt(plainText);
console.log("\n==================================================");
console.log("Encrypted Output (Copy and paste this into .env):");
console.log("==================================================");
console.log(encryptedValue);
console.log("==================================================\n");
