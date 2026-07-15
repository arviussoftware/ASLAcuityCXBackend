import { connectToDatabase } from "@/lib/sql.js";
import { checkAuthOnly, ok, internal } from "@/lib/route-helpers";
import { generateExpiryToken } from "@/lib/exporter/token.js";
import { logError } from "@/lib/errorLogger";
import { isSuperAdminFromRequest } from "@/lib/auth/superAdmin.js";

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

function normalizeDestPrefix(prefix) {
  const p = String(prefix ?? "").trim().replace(/\\/g, "/");
  if (!p) return "";
  return p.replace(/^\/+/, "").replace(/\/+$/, "");
}

function ruleBasePrefixForCfg(destPrefix, exportConfigId, cfg) {
  const ruleName = safePathSegment(cfg?.RuleName, `rule_${exportConfigId}`);
  const folder = `${ruleName}_${exportConfigId}`;
  const p = String(destPrefix || "").trim();
  return p ? `${p}/exports/${folder}` : `exports/${folder}`;
}

function getLocalVirtualDirectoryLink(basePrefix) {
  const physicalRoot = String(process.env.LOCAL_PHYSICAL_ROOT || "").trim().replace(/\\/g, "/");
  const webRoot = String(process.env.LOCAL_WEB_ROOT_URL || "").trim().replace(/\/+$/, "");
  const normalizedPrefix = basePrefix.replace(/\\/g, "/");
  
  if (physicalRoot && normalizedPrefix.startsWith(physicalRoot)) {
    const relative = normalizedPrefix.slice(physicalRoot.length).replace(/^\/+/, "");
    return `${webRoot}/${relative}`;
  }
  
  return `${webRoot}/${normalizedPrefix}`;
}

export async function GET(request) {
  try {
    const authErr = checkAuthOnly(request);
    if (authErr) return authErr;

    const db = await connectToDatabase();
    
    // Fetch last 30 runs from TblLog_ExportAudit joined with TblMst_ExportConfiguration for RuleName
    const query = `
      SELECT a.id, a.exportconfigid, c."RuleName", c."ExportPath", c."DestDirectory",
             c."S3BucketName", c."S3BucketRegion", c."CreatedBy",
             a.totalcandidates, a.copied, a.failedcount, a.status, a.createdat, a.errormessage,
             a.folderlink
      FROM TblLog_ExportAudit a
      JOIN "TblMst_ExportConfiguration" c ON a.exportconfigid = c."Id"
      ORDER BY a.createdat DESC
      LIMIT 30
    `;
    const res = await db.query(query);
    const rows = res?.rows ?? [];

    const reqUrl = new URL(request.url);
    const reqHostname = reqUrl.host;
    const protocol = reqUrl.protocol || "http:";

    const expiryHours = Number(process.env.EXPORT_LINK_EXPIRY_HOURS || 120);
    const isSuperAdmin = await isSuperAdminFromRequest().catch(() => false);
    const loggedInUserIdRaw = request.headers.get("loggedInUserId") || request.headers.get("loggedinuserid");
    const loggedInUserIdNum = loggedInUserIdRaw ? Number(loggedInUserIdRaw) : null;

    const data = rows.map((r) => {
      const configId = r.exportconfigid;
      const createdAtMs = new Date(r.createdat).getTime();
      const expiresAt = createdAtMs + expiryHours * 60 * 60 * 1000;
      
      const createdByRaw = r.CreatedBy ?? r.createdby ?? r.createdBy ?? null;
      const createdByNum = createdByRaw !== null ? Number(createdByRaw) : null;
      
      const isLocal = String(r.ExportPath || "").trim().toUpperCase() === "LOCAL";
      let folderLink = r.folderlink || "";
      
      if (!folderLink) {
        if (isLocal) {
          const destPrefix = normalizeDestPrefix(process.env.LOCAL_PHYSICAL_ROOT || r.DestDirectory);
          const basePrefix = ruleBasePrefixForCfg(destPrefix, configId, r);
          folderLink = getLocalVirtualDirectoryLink(basePrefix);
        } else {
          // S3 mode: generate AWS Console link pointing directly to the exported folder
          const s3Bucket   = String(r.S3BucketName   || r.s3bucketname   || "").trim();
          const s3Region   = String(r.S3BucketRegion || r.s3bucketregion || process.env.AWS_REGION || "us-east-1").trim();
          const destPrefix = normalizeDestPrefix(r.DestDirectory);
          const basePrefix = ruleBasePrefixForCfg(destPrefix, configId, r);
          const folderPrefix = encodeURIComponent(basePrefix + "/");

          if (s3Bucket) {
            folderLink = `https://s3.console.aws.amazon.com/s3/buckets/${s3Bucket}?prefix=${folderPrefix}&region=${s3Region}`;
          }
        }
      }

      // Hide the link if the logged-in user is not the one who created the rule (unless they are a super admin)
      const isCreator = createdByNum !== null && !Number.isNaN(createdByNum) && createdByNum === loggedInUserIdNum;
      if (!isSuperAdmin && createdByNum !== null && !isCreator) {
        folderLink = "";
      }

      const downloadLink = null;
      const webLink = folderLink;

      return {
        id: String(r.id),
        exportConfigId: configId,
        ruleName: r.RuleName,
        timestamp: createdAtMs,
        webLink,
        downloadLink,
        folderLink,
        isLocal,
        totalCandidates: r.totalcandidates ?? 0,
        copied: r.copied ?? 0,
        failedCount: r.failedcount ?? 0,
        errorSummary: r.errormessage,
        expiryHours,
        expiresAt,
        status: r.status,
      };
    });

    return ok({ data });
  } catch (error) {
    await logError("GET /api/workFlow/getExportHistory", error);
    console.error("[getExportHistory] Error:", error);
    return internal();
  }
}
