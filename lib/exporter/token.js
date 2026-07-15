import CryptoJS from "crypto-js";

const SECRET = process.env.API_SECRET_KEY || "fallback-secret-123456";

 
export function generateExpiryToken(configId, runCreatedAt) {
  const expiryHours = Number(process.env.EXPORT_LINK_EXPIRY_HOURS || 120);
  const baseTime = runCreatedAt ? new Date(runCreatedAt).getTime() : Date.now();
  const expiresAt = baseTime + expiryHours * 60 * 60 * 1000;
  const payload = JSON.stringify({ configId, expiresAt });
  
  // Encrypt payload
  const encrypted = CryptoJS.AES.encrypt(payload, SECRET).toString();
  // Make the base64 URL-safe by encoding special characters
  return encodeURIComponent(encrypted);
}

/**
 * Decrypts the token and verifies it has not expired and matches the expected rule ID.
 */
export function verifyExpiryToken(tokenStr, expectedConfigId) {
  try {
    const decoded = decodeURIComponent(tokenStr);
    const bytes = CryptoJS.AES.decrypt(decoded, SECRET);
    const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
    if (!decryptedText) {
      return { valid: false, reason: "Decryption failed - empty payload" };
    }

    const data = JSON.parse(decryptedText);
    if (Number(data.configId) !== Number(expectedConfigId)) {
      return { valid: false, reason: "Config ID mismatch" };
    }

    if (Date.now() > Number(data.expiresAt)) {
      return { valid: false, reason: "Link expired" };
    }

    return { valid: true, payload: data };
  } catch (err) {
    return { valid: false, reason: `Token verification failed: ${err.message}` };
  }
}

export function encryptText(text) {
  if (!text) return "";
  return CryptoJS.AES.encrypt(text, SECRET).toString();
}

export function decryptText(ciphertext) {
  if (!ciphertext) return "";
  // Quick optimization check: encrypted base64 string from CryptoJS starts with U2FsdGVkX1
  if (!ciphertext.startsWith("U2FsdGVkX1")) {
    return ciphertext;
  }
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    return decrypted || ciphertext;
  } catch (err) {
    return ciphertext;
  }
}

