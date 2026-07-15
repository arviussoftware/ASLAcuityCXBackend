"use client";

import CryptoJS from "crypto-js";

export function getSessionUser() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const encryptedUserData = sessionStorage.getItem("user");

    if (!encryptedUserData) {
      return null;
    }

    const bytes = CryptoJS.AES.decrypt(encryptedUserData, "");
    const decryptedData = bytes.toString(CryptoJS.enc.Utf8);

    return decryptedData ? JSON.parse(decryptedData) : null;
  } catch (error) {
    console.error("Failed to read session user:", error);
    return null;
  }
}

export function getSessionUserId() {
  return getSessionUser()?.userId ?? null;
}
