import { NextResponse } from "next/server";
import { executeStoredProcedure, connectToDatabase } from "@/lib/sql.js";
import { verifyExpiryToken } from "@/lib/exporter/token.js";
import { createS3Client, normalizeDestPrefix } from "@/lib/exporter/s3.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logError } from "@/lib/errorLogger";
import path from "path";

export const dynamic = "force-dynamic";

function getLocalVirtualDirectoryLink(filePath) {
  const physicalRoot = String(process.env.LOCAL_PHYSICAL_ROOT || "").trim().replace(/\\/g, "/");
  const webRoot = String(process.env.LOCAL_WEB_ROOT_URL || "").trim().replace(/\/+$/, "");
  const normalizedPath = filePath.replace(/\\/g, "/");
  
  if (physicalRoot && normalizedPath.startsWith(physicalRoot)) {
    const relative = normalizedPath.slice(physicalRoot.length).replace(/^\/+/, "");
    return `${webRoot}/${relative}`;
  }
  
  return `${webRoot}/${normalizedPath}`;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const configId = searchParams.get("configId");
    const token = searchParams.get("token");

    if (!configId || !token) {
      return NextResponse.json({ success: false, message: "Missing required parameters." }, { status: 400 });
    }

    // 1. Verify Token
    const verification = verifyExpiryToken(token, configId);
    if (!verification.valid) {
      return NextResponse.json({ success: false, expired: true, message: "Link has expired or is invalid." }, { status: 403 });
    }

    const expiresAt = verification.payload?.expiresAt ? Number(verification.payload.expiresAt) : null;
    const expiryHours = Number(process.env.EXPORT_LINK_EXPIRY_HOURS || 120);
    const runStartedAt = expiresAt ? (expiresAt - expiryHours * 60 * 60 * 1000) : (Date.now() - expiryHours * 60 * 60 * 1000);

    // 2. Fetch config details
    const ctxRes = await executeStoredProcedure("usp_GetExportJobContext", { ExportConfigId: Number(configId) });
    const cfg = ctxRes?.recordsets?.[0]?.[0] ?? null;
    const app = ctxRes?.recordsets?.[1]?.[0] ?? null;

    if (!cfg) {
      return NextResponse.json({ success: false, message: "Export configuration not found." }, { status: 404 });
    }

    const exportPath = String(cfg.ExportPath || "").trim().toUpperCase();
    const isLocal = exportPath === "LOCAL";

    // 3. Query files exported in this run
    const db = await connectToDatabase();
    const query = `
      SELECT s3destbucket, s3destkey, exportedat, payloadtype
      FROM tbllog_exporthistory
      WHERE exportconfigid = $1
        AND exportedat >= $2
      ORDER BY exportedat ASC
    `;
    const filesRes = await db.query(query, [Number(configId), new Date(runStartedAt - 60 * 1000)]); // 1 minute safety buffer
    let files = filesRes?.rows ?? [];

    // Fallback: get all files from last 24h/5d if run window failed to load
    if (files.length === 0) {
      const fallbackQuery = `
        SELECT s3destbucket, s3destkey, exportedat, payloadtype
        FROM tbllog_exporthistory
        WHERE exportconfigid = $1
          AND exportedat >= NOW() - INTERVAL '${expiryHours} hours'
        ORDER BY exportedat ASC
      `;
      const fbRes = await db.query(fallbackQuery, [Number(configId)]);
      files = fbRes?.rows ?? [];
    }

    // 4. Setup S3 Client if needed
    let s3 = null;
    if (!isLocal) {
      const destAccessKey = String(cfg.S3AccessKey || "").trim();
      const destSecretKey = String(cfg.S3SecretKey || "").trim();
      const destRegion =
        String(cfg.S3BucketRegion || "").trim() ||
        String(app?.SourceS3BucketRegion || "").trim() ||
        String(process.env.AWS_REGION || "").trim() ||
        "us-east-1";

      s3 = createS3Client({
        region: destRegion,
        accessKeyId: destAccessKey,
        secretAccessKey: destSecretKey,
      });
    }

    // 5. Generate secure links
    const mappedFiles = await Promise.all(
      files.map(async (file) => {
        const filePath = file.s3destkey;
        const filename = path.basename(filePath.replace(/\\/g, "/"));
        let downloadUrl = "";

        if (isLocal) {
          downloadUrl = getLocalVirtualDirectoryLink(filePath);
        } else {
          try {
            const command = new GetObjectCommand({
              Bucket: file.s3destbucket,
              Key: filePath,
            });
            // Presign S3 URL valid for 1 hour (3600 seconds)
            downloadUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
          } catch (err) {
            console.error(`[getExportFiles] Failed to presign URL for S3 key ${filePath}:`, err);
            downloadUrl = ""; // fallback empty
          }
        }

        return {
          filename,
          payloadType: file.payloadtype || "recording",
          downloadUrl,
          exportedAt: file.exportedat,
        };
      })
    );

    return NextResponse.json({
      success: true,
      ruleName: cfg.RuleName,
      exportPath: exportPath,
      files: mappedFiles,
      expiresAt,
      expiryHours,
    });

  } catch (err) {
    await logError("GET /api/workFlow/getExportFiles", err);
    console.error("[getExportFiles] Endpoint error:", err);
    return NextResponse.json({ success: false, message: "Internal server error." }, { status: 500 });
  }
}
