import crypto from "crypto";
import { connectToDatabase } from "./sql.js";

const ALGORITHM = "aes-256-cbc";
const KEY_MATERIAL = process.env.API_SECRET_KEY;

// Cache map: key format is 'providerType:connectionName' => { data, timestamp }
const credentialsCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

function getEncryptionKey() {
  if (!KEY_MATERIAL) {
    throw new Error("API_SECRET_KEY is not defined in environment variables");
  }
  return crypto.createHash("sha256").update(KEY_MATERIAL).digest();
}

function decrypt(encryptedText) {
  if (!encryptedText) return "";
  try {
    const key = getEncryptionKey();
    const parts = encryptedText.split(":");
    if (parts.length < 2) return encryptedText; // Fallback if not encrypted
    const iv = Buffer.from(parts.shift(), "hex");
    const encrypted = Buffer.from(parts.join(":"), "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, undefined, "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error(
      "Decryption failed for connection configuration:",
      err.message,
    );
    return "";
  }
}

/**
 * Retrieves and decrypts the connection configuration from the database.
 * Uses cache with a 5-minute TTL.
 *
 * @param {string} providerType e.g., 'aws-s3', 'gcp'
 * @param {string} connectionName e.g., 'default_aws_s3'
 * @returns {Promise<Object>} The decrypted configuration object
 */
export async function getConnectionCredentials(providerType, connectionName) {
  const cacheKey = `${providerType}:${connectionName}`;
  const now = Date.now();
  const cached = credentialsCache.get(cacheKey);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const pool = await connectToDatabase();
    const result = await pool.query(
      "SELECT encrypted_config FROM public.tblmst_connection WHERE provider_type = $1 AND connection_name = $2 AND is_active = TRUE LIMIT 1",
      [providerType, connectionName],
    );

    if (result.rows.length === 0) {
      throw new Error(
        `No active connection found for provider_type: '${providerType}' and connection_name: '${connectionName}'.`,
      );
    }

    const decryptedStr = decrypt(result.rows[0].encrypted_config);
    const configData = JSON.parse(decryptedStr);

    credentialsCache.set(cacheKey, {
      data: configData,
      timestamp: now,
    });

    return configData;
  } catch (error) {
    console.error(
      `Failed to fetch connection credentials for ${cacheKey} from database:`,
      error.message,
    );
    // If we have a stale cache, return it
    if (cached) {
      return cached.data;
    }
    throw error;
  }
}

/**
 * For backwards compatibility with existing backend routes.
 * Retrieves S3 / AWS credentials from the generalized connection table.
 */
export async function getAWSCredentials() {
  try {
    return await getConnectionCredentials("aws-s3", "default_aws_s3");
  } catch (error) {
    console.error("Fallback check in getAWSCredentials:", error.message);
    // Final fallback to process.env in case database table query fails entirely
    return {
      REGION: process.env.REGION || "",
      BUCKET: process.env.BUCKET || "",
      Amazon_ACCESS_KEY_ID: process.env.Amazon_ACCESS_KEY_ID || "",
      Amazon_SECRET_ACCESS_KEY: process.env.Amazon_SECRET_ACCESS_KEY || "",
      TRANSCRIPTION_FOLDER:
        process.env.TRANSCRIPTION_FOLDER || "Transcriptions",
    };
  }
}
