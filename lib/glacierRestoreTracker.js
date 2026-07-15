import {
  HeadObjectCommand,
  RestoreObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { executeStoredProcedure, connectToDatabase } from "@/lib/sql.js";
import { getAWSCredentials } from "@/lib/connectionCredentials";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

const ARCHIVED_STORAGE_CLASSES = new Set([
  "GLACIER",
  "DEEP_ARCHIVE",
  "GLACIER_IR",
]);

const DEFAULT_PAYLOAD_TYPE = "AUDIO";
const DEFAULT_EXPORT_CONFIG_ID = Number(
  process.env.GLACIER_INTERACTION_EXPORT_CONFIG_ID || 0,
);

export function resolveSourceType(rawSourceType, filePath = "") {
  const normalized = String(rawSourceType || "")
    .trim()
    .toLowerCase();
  if (filePath.startsWith("s3://")) return "aws-s3";
  if (normalized === "3" || normalized === "aws-s3") return "aws-s3";
  return normalized || "local";
}

export function parseS3Path(filePath, bucketFallback = "") {
  const rawPath = String(filePath || "").trim();
  if (!rawPath) return null;

  if (rawPath.startsWith("s3://")) {
    const withoutPrefix = rawPath.slice(5);
    const slashIdx = withoutPrefix.indexOf("/");
    if (slashIdx <= 0) return null;
    return {
      bucket: withoutPrefix.slice(0, slashIdx),
      key: withoutPrefix.slice(slashIdx + 1),
    };
  }

  const bucket = String(bucketFallback || "").trim();
  return bucket ? { bucket, key: rawPath } : null;
}

export async function createSourceS3Client() {
  const creds = await getAWSCredentials();
  const accessKeyId =
    creds.AWS_ACCESS_KEY_ID ||
    creds.Amazon_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.Amazon_ACCESS_KEY_ID ||
    "";
  const secretAccessKey =
    creds.AWS_SECRET_ACCESS_KEY ||
    creds.Amazon_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.Amazon_SECRET_ACCESS_KEY ||
    "";

  return {
    creds,
    s3: new S3Client({
      region: creds.REGION || process.env.REGION || "",
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    }),
  };
}

export function getRestoreStatusFromHead(head) {
  const storageClass = String(head?.StorageClass || "STANDARD").toUpperCase();
  const restoreHeader = String(head?.Restore || "");
  const isArchived = ARCHIVED_STORAGE_CLASSES.has(storageClass);

  if (!isArchived) {
    return {
      status: "standard",
      storageClass,
      message: "The call is ready to play.",
    };
  }

  if (restoreHeader.includes('ongoing-request="true"')) {
    return {
      status: "retrieving",
      storageClass,
      message: "The call is being restored from Glacier.",
    };
  }

  if (restoreHeader.includes('ongoing-request="false"')) {
    const expiryMatch = restoreHeader.match(/expiry-date="([^"]+)"/);
    if (expiryMatch) {
      const expiryDate = new Date(expiryMatch[1]);
      if (expiryDate < new Date()) {
        return {
          status: "needs_retrieval",
          storageClass,
          message: "The restored period has expired. The call must be restored again.",
        };
      }
    }
    return {
      status: "retrieved",
      storageClass,
      message: "The call is ready to play.",
    };
  }

  return {
    status: "needs_retrieval",
    storageClass,
    message: "The call must be restored before playback.",
  };
}

function getFirstRecord(result) {
  const recordsets = Array.isArray(result?.recordsets) ? result.recordsets : [];
  if (Array.isArray(recordsets[0]) && recordsets[0][0]) {
    return recordsets[0][0];
  }

  const recordset = Array.isArray(result?.recordset) ? result.recordset : [];
  return recordset[0] || null;
}

function normalizeDbRestoreStatus(status) {
  const value = String(status || "").trim().toUpperCase();
  if (value === "RETRIEVED" || value === "READY") return "READY";
  if (value === "RETRIEVING" || value === "IN_PROGRESS" || value === "INITIATED") return "IN_PROGRESS";
  if (value === "FAILED") return "FAILED";
  if (value === "NEEDS_RETRIEVAL") return "NEEDS_RETRIEVAL";
  if (value === "STANDARD") return "STANDARD";
  return value || "INITIATED";
}

function normalizeClientRestoreStatus(status) {
  const value = String(status || "").trim().toUpperCase();
  if (value === "READY" || value === "NOTIFIED" || value === "STANDARD") return "RETRIEVED";
  if (value === "IN_PROGRESS" || value === "INITIATED") return "RETRIEVING";
  return value;
}

export function normalizeRestoreStatusForClient(status) {
  const value = normalizeClientRestoreStatus(status).toLowerCase();
  if (value === "retrieved") return "retrieved";
  if (value === "retrieving") return "retrieving";
  if (value === "failed") return "failed";
  if (value === "needs_retrieval") return "needs_retrieval";
  if (value === "unsupported") return "unsupported";
  return value || null;
}

function buildRestoreRecord(row) {
  if (!row) return null;

  const status = row.Status ?? row.status ?? null;
  const requestedAt = row.RequestedAt ?? row.requestedat ?? null;
  const nextCheckAt = row.NextCheckAt ?? row.nextcheckat ?? null;

  return {
    ...row,
    Status: normalizeClientRestoreStatus(status),
    ClientStatus: normalizeRestoreStatusForClient(status),
    DbStatus: status,
    RequestedAt: requestedAt,
    NextCheckAt: nextCheckAt,
  };
}

export async function writeRestoreRecord({
  interactionId,
  filePath,
  status,
  payloadType = DEFAULT_PAYLOAD_TYPE,
  exportConfigId = DEFAULT_EXPORT_CONFIG_ID,
}) {
  if (!interactionId || !filePath) {
    await logWarning(
      "glacierRestoreTracker.writeRestoreRecord",
      "Missing interaction id or file path.",
      {
        interactionId,
        hasFilePath: Boolean(filePath),
      },
    );
    return null;
  }

  const dbStatus = normalizeDbRestoreStatus(status);

  try {
    const upserted = await upsertGlacierRestoreRequest({
      interactionId,
      filePath,
      payloadType,
      exportConfigId,
    });

    if (dbStatus === "READY" || dbStatus === "NOTIFIED") {
      await executeStoredProcedure("usp_markglacierrestoreready", {
        interactionid: Number(interactionId),
        payloadtype: payloadType,
      });
    } else if (dbStatus === "IN_PROGRESS") {
      await executeStoredProcedure("usp_markglacierrestoreinprogress", {
        interactionid: Number(interactionId),
        payloadtype: payloadType,
      });
    } else if (dbStatus === "FAILED") {
      await executeStoredProcedure("usp_markglacierrestorefailed", {
        interactionid: Number(interactionId),
        payloadtype: payloadType,
      });
    } else if (dbStatus === "NEEDS_RETRIEVAL") {
      const pool = await connectToDatabase();
      await pool.query(
        'UPDATE public."TblLog_GlacierRestoration" SET "Status" = \'NEEDS_RETRIEVAL\', "NextCheckAt" = NULL WHERE "InteractionId" = $1 AND "PayloadType" = $2',
        [String(interactionId), payloadType]
      );
    } else if (dbStatus === "STANDARD") {
      const pool = await connectToDatabase();
      await pool.query(
        'UPDATE public."TblLog_GlacierRestoration" SET "Status" = \'STANDARD\', "NextCheckAt" = NULL WHERE "InteractionId" = $1 AND "PayloadType" = $2',
        [String(interactionId), payloadType]
      );
    }

    await logSuccess(
      "glacierRestoreTracker.writeRestoreRecord",
      "Glacier restore record updated.",
      {
        interactionId,
        payloadType,
        status: dbStatus,
      },
    );

    return upserted;
  } catch (error) {
    await logError("glacierRestoreTracker.writeRestoreRecord", error, {
      interactionId,
      payloadType,
      status: dbStatus,
    });
    throw error;
  }
}

export async function readRestoreRecord({
  interactionId,
  filePath,
  payloadType = DEFAULT_PAYLOAD_TYPE,
}) {
  if (!interactionId || !filePath) {
    await logWarning(
      "glacierRestoreTracker.readRestoreRecord",
      "Missing interaction id or file path.",
      {
        interactionId,
        hasFilePath: Boolean(filePath),
      },
    );
    return null;
  }

  try {
    const result = await executeStoredProcedure(
      "fn_getglacierstatusforinteractions",
      {
        interactionids: [Number(interactionId)],
        payloadtype: payloadType,
      },
    );

    const row = getFirstRecord(result);
    if (!row) return null;

    return buildRestoreRecord(row);
  } catch (error) {
    await logError("glacierRestoreTracker.readRestoreRecord", error, {
      interactionId,
      payloadType,
    });
    throw error;
  }
}

export async function getObjectRestoreStatus({ filePath, fileSourceType }) {
  if (resolveSourceType(fileSourceType, filePath) !== "aws-s3") {
    return {
      status: "retrieved",
      storageClass: null,
      message: "The call is ready to play.",
    };
  }

  const { creds, s3 } = await createSourceS3Client();
  const parsed = parseS3Path(filePath, creds.BUCKET);
  if (!parsed) {
    return {
      status: "unsupported",
      storageClass: null,
      message: "The S3 path is invalid.",
    };
  }

  const head = await s3.send(
    new HeadObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
  );
  return getRestoreStatusFromHead(head);
}

export async function initiateObjectRestore({
  interactionId,
  filePath,
  fileSourceType,
  createdBy = null,
}) {
  const { creds, s3 } = await createSourceS3Client();
  const parsed = parseS3Path(filePath, creds.BUCKET);
  if (!parsed || resolveSourceType(fileSourceType, filePath) !== "aws-s3") {
    return {
      status: "unsupported",
      storageClass: null,
      message: "Only S3 recordings can be restored from Glacier.",
    };
  }

  const head = await s3.send(
    new HeadObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
  );
  const current = getRestoreStatusFromHead(head);

  if (current.status === "retrieved" || current.status === "standard") {
    await writeRestoreRecord({ interactionId, filePath, status: current.status, createdBy });
    return current;
  }

  if (current.status === "retrieving") {
    await writeRestoreRecord({ interactionId, filePath, status: "retrieving", createdBy });
    return current;
  }

  try {
    await s3.send(
      new RestoreObjectCommand({
        Bucket: parsed.bucket,
        Key: parsed.key,
        RestoreRequest: {
          Days: Number(process.env.GLACIER_RESTORE_DAYS || 2),
          GlacierJobParameters: {
            Tier: process.env.GLACIER_RESTORE_TIER || "Standard",
          },
        },
      }),
    );
  } catch (error) {
    const code = String(error?.name || error?.Code || error?.code || "");
    if (code !== "RestoreAlreadyInProgress") {
      throw error;
    }
  }

  // Atomic upsert — no dupes if the row already exists in a non-final state.
  const upserted = await upsertGlacierRestoreRequest({
    interactionId,
    filePath,
    createdBy,
  });

  return {
    status: "retrieving",
    storageClass: current.storageClass,
    message: "Restore started. Glacier retrieval usually takes 12 to 48 hours.",
    requestedAt: upserted?.requestedat ?? null,
  };
}

export async function upsertGlacierRestoreRequest({
  interactionId,
  filePath,
  payloadType = DEFAULT_PAYLOAD_TYPE,
  exportConfigId = DEFAULT_EXPORT_CONFIG_ID,
  createdBy = null,
}) {
  if (!interactionId || !filePath) {
    await logWarning(
      "glacierRestoreTracker.upsertGlacierRestoreRequest",
      "Missing interaction id or file path.",
      {
        interactionId,
        hasFilePath: Boolean(filePath),
      },
    );
    return null;
  }

  const inputParams = {
    exportconfigid: exportConfigId,
    interactionid: Number(interactionId),
    payloadtype: payloadType,
    s3path: filePath,
  };

  const result = await executeStoredProcedure(
    "usp_upsertglacierrestorerequest",
    inputParams,
  );

  try {
    const pool = await connectToDatabase();
    await pool.query(
      'UPDATE public."TblLog_GlacierRestoration" SET "NextCheckAt" = now() + interval \'12 hours\' WHERE "InteractionId" = $1 AND "PayloadType" = $2 AND "Status" = \'INITIATED\'',
      [String(interactionId), payloadType]
    );
  } catch (dbErr) {
    console.error("[glacierRestoreTracker] Failed to update NextCheckAt to 12h on upsert:", dbErr.message);
  }

  const recordsets = Array.isArray(result?.recordsets) ? result.recordsets : [];
  const row = Array.isArray(recordsets[0]) ? recordsets[0][0] : null;

  if (row && createdBy) {
    try {
      await executeStoredProcedure("usp_updateglacierrestorecreatedby", {
        interactionid: Number(interactionId),
        payloadtype: payloadType,
        createdby: Number(createdBy),
      });
      row.createdby = Number(createdBy);
    } catch (e) {
      console.error("[glacierRestoreTracker] Failed to update CreatedBy on upsert:", e);
    }
  }

  return row || null; // { interactionid, payloadtype, status, requestedat }
}

export function isGlacierRestoreRequiredError(error) {
  const code = String(error?.name || error?.Code || error?.code || "");
  if (code === "InvalidObjectState") return true;
  return /invalid.*object.*state/i.test(String(error?.message || ""));
}
