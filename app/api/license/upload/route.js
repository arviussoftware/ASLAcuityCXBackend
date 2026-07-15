import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parseLicenseFromEncryptedBase64 } from "@/lib/licenseService";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { licenseBase64 } = body || {};
    if (!licenseBase64) {
      return NextResponse.json(
        { message: "licenseBase64 is required" },
        { status: 400 },
      );
    }

    // Validate by attempting to decrypt and parse the supplied base64 payload
    const licenseObj = parseLicenseFromEncryptedBase64(licenseBase64);

    // Accept either the new format { modules: [...] } or the legacy format
    const isNewFormat = Array.isArray(licenseObj.modules);
    const isLegacyFormat =
      Array.isArray(licenseObj.allowedModules) && licenseObj.expiryDate;

    if (!isNewFormat && !isLegacyFormat) {
      return NextResponse.json(
        { message: "Invalid license structure" },
        { status: 400 },
      );
    }

    // If new format, do a lightweight validation of module entries
    if (isNewFormat) {
      for (const m of licenseObj.modules) {
        if (typeof m.moduleId === "undefined") {
          return NextResponse.json(
            { message: "Each module must include moduleId" },
            { status: 400 },
          );
        }
        // moduleName optional; expiryDate optional (means no expiry)
      }
    }

    // Persist the encrypted license bytes only (do not store decrypted JSON)
    const outPath = path.join(process.cwd(), "license.lic");
    const raw = Buffer.from(licenseBase64, "base64");
    fs.writeFileSync(outPath, raw);

    return NextResponse.json({ message: "License uploaded" }, { status: 200 });
  } catch (err) {
    console.error("License upload failed:", err);
    return NextResponse.json(
      { message: "Failed to upload or validate license", error: err.message },
      { status: 500 },
    );
  }
}
