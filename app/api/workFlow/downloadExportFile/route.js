import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { executeStoredProcedure, connectToDatabase } from "@/lib/sql.js";
import { verifyExpiryToken } from "@/lib/exporter/token.js";
import { createS3Client, normalizeDestPrefix } from "@/lib/exporter/s3.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import archiver from "archiver";
import { Readable } from "stream";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

function safePathSegment(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const cleaned = raw
    .replace(/[\/\\]/g, "-")
    .replace(/[:*?"<>|]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function ruleBasePrefixForCfg(destPrefix, exportConfigId, cfg) {
  const ruleName = safePathSegment(cfg?.RuleName, `rule_${exportConfigId}`);
  const folder = `${ruleName}_${exportConfigId}`;
  const p = String(destPrefix || "").trim();
  return p ? `${p}/exports/${folder}` : `exports/${folder}`;
}

function htmlResponse(title, heading, message, status = 400) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      padding: 2.5rem;
      border-radius: 1rem;
      text-align: center;
      max-width: 450px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    .icon {
      font-size: 3rem;
      margin-bottom: 1rem;
      color: #ef4444;
    }
    h1 {
      font-size: 1.5rem;
      margin-top: 0;
      margin-bottom: 0.5rem;
      font-weight: 700;
    }
    p {
      color: #94a3b8;
      font-size: 0.875rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    .btn {
      display: inline-block;
      background: #3b82f6;
      color: white;
      text-decoration: none;
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: background 0.2s;
    }
    .btn:hover {
      background: #2563eb;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>${heading}</h1>
    <p>${message}</p>
    <button onclick="window.close()" class="btn">Close Window</button>
  </div>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const configId = searchParams.get("configId");
    const token = searchParams.get("token");

    if (!configId || !token) {
      return htmlResponse(
        "Invalid Link",
        "Invalid Download Link",
        "The download link is missing required parameters. Please check the URL and try again."
      );
    }

    const expiryHours = Number(process.env.EXPORT_LINK_EXPIRY_HOURS || 120);

    // Verify token
    const verification = verifyExpiryToken(token, configId);
    if (!verification.valid) {
      return htmlResponse(
        "Link Expired",
        "Download Link Expired",
        `For your security, download links expire after ${expiryHours} hours. Please run the export rule again to generate a new link.`
      );
    }

    const expiresAt = verification.payload?.expiresAt ? Number(verification.payload.expiresAt) : null;
    const runStartedAt = expiresAt ? (expiresAt - expiryHours * 60 * 60 * 1000) : (Date.now() - expiryHours * 60 * 60 * 1000);

    // Fetch context
    const ctxRes = await executeStoredProcedure("usp_GetExportJobContext", { ExportConfigId: Number(configId) });
    const cfg = ctxRes?.recordsets?.[0]?.[0] ?? null;
    const app = ctxRes?.recordsets?.[1]?.[0] ?? null;

    if (!cfg) {
      return htmlResponse(
        "Configuration Not Found",
        "Rule Not Found",
        "The requested export configuration could not be found or has been deleted."
      );
    }

    const exportPath = String(cfg.ExportPath || "").trim().toUpperCase();
    const isLocal = exportPath === "LOCAL";

    // Query files exported in this run
    const db = await connectToDatabase();
    const query = `
      SELECT s3destbucket, s3destkey, exportedat
      FROM tbllog_exporthistory
      WHERE exportconfigid = $1
        AND exportedat >= $2
      ORDER BY exportedat ASC
    `;
    const filesRes = await db.query(query, [Number(configId), new Date(runStartedAt - expiryHours * 60 * 60 * 1000)]);
    let files = filesRes?.rows ?? [];

    // Fallback: if no files found since run start, get all files from last 24h
    if (files.length === 0) {
      const fallbackQuery = `
        SELECT s3destbucket, s3destkey, exportedat
        FROM tbllog_exporthistory
        WHERE exportconfigid = $1
          AND exportedat >= NOW() - INTERVAL '24 hours'
        ORDER BY exportedat ASC
      `;
      const fbRes = await db.query(fallbackQuery, [Number(configId)]);
      files = fbRes?.rows ?? [];
    }

    if (files.length === 0) {
      return htmlResponse(
        "No Files Found",
        "No Exported Files Found",
        "There are no exported files available for download in this batch. Please verify the rule execution status."
      );
    }

    // Set up Archiver
    const archive = archiver("zip", { zlib: { level: 9 } });

    // Determine normalized base prefix for zipping structure
    const destPrefix = normalizeDestPrefix(isLocal ? (process.env.LOCAL_PHYSICAL_ROOT || cfg.DestDirectory) : cfg.DestDirectory);
    const basePrefix = ruleBasePrefixForCfg(destPrefix, configId, cfg);

    // Setup S3 Client if needed
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

    // Convert archiver stream to web standard ReadableStream
    const webStream = Readable.toWeb(archive);

    // Pipe the files into archiver asynchronously
    const errors = [];
    
    // Background task to pump files into archiver
    (async () => {
      try {
        for (const file of files) {
          const filePath = file.s3destkey;
          let entryName = filePath.replace(/\\/g, "/");
          const normalizedBase = basePrefix.replace(/\\/g, "/");
          const idx = entryName.indexOf(normalizedBase);
          if (idx >= 0) {
            entryName = entryName.slice(idx + normalizedBase.length).replace(/^\/+/, "");
          } else {
            entryName = path.basename(entryName);
          }

          if (isLocal) {
            let resolvedPath = filePath;
            if (!fs.existsSync(resolvedPath)) {
              if (resolvedPath.toLowerCase().startsWith("e:\\")) {
                // Construct "C:\" dynamically using character codes to prevent Turbopack 
                // from trying to resolve the root path at build time.
                const drive = "C" + String.fromCharCode(58) + String.fromCharCode(92);
                const fallback = drive + resolvedPath.slice(3);
                if (fs.existsSync(fallback)) resolvedPath = fallback;
              }
            }

            if (fs.existsSync(resolvedPath)) {
              archive.append(fs.createReadStream(resolvedPath), { name: entryName });
            } else {
              errors.push(`Local file not found: ${filePath}`);
            }
          } else {
            try {
              const getRes = await s3.send(new GetObjectCommand({ Bucket: file.s3destbucket, Key: filePath }));
              if (getRes?.Body) {
                archive.append(getRes.Body, { name: entryName });
              } else {
                errors.push(`S3 file body empty: ${filePath}`);
              }
            } catch (err) {
              errors.push(`S3 download failed for key ${filePath}: ${err.message}`);
            }
          }
        }

        if (errors.length > 0) {
          archive.append(errors.join("\n"), { name: "download_errors.txt" });
        }

        await archive.finalize();
      } catch (err) {
        console.error("[downloadExportFile] Archiver processing error:", err);
        archive.destroy(err);
      }
    })();

    const cleanRuleName = (cfg.RuleName || `export_${configId}`)
      .replace(/[^a-zA-Z0-9-_]/g, "_")
      .slice(0, 50);

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${cleanRuleName}.zip"`,
      },
    });

  } catch (err) {
    await logError("GET /api/workFlow/downloadExportFile", err);
    console.error("[downloadExportFile] Endpoint error:", err);
    return htmlResponse(
      "Server Error",
      "Internal Server Error",
      "An unexpected error occurred while preparing your download. Please contact support."
    );
  }
}
