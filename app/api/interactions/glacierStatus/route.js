import { NextResponse } from "next/server";
import {
  getObjectRestoreStatus,
  initiateObjectRestore,
  normalizeRestoreStatusForClient,
  readRestoreRecord,
  resolveSourceType,
  writeRestoreRecord,
} from "@/lib/glacierRestoreTracker";
import { logError, logWarning } from "@/lib/errorLogger";
import { connectToDatabase, executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;



function verifyAuth(req) {
  const authHeader = req.headers.get("authorization") || "";
  return (
    authHeader.startsWith("Bearer ") &&
    authHeader.split(" ")[1] === API_SECRET_TOKEN
  );
}

function normalizeInteractionId(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) ? text : null;
}

function normalizeStatusForDb(status) {
  if (status === "retrieved") return "retrieved";
  if (status === "retrieving") return "retrieving";
  if (status === "needs_retrieval") return "needs_retrieval";
  if (status === "failed") return "failed";
  if (status === "standard") return "standard";
  return null;
}

function buildTrackedStatusResponse({ interactionId, filePath, record }) {
  const status = normalizeRestoreStatusForClient(
    record?.Status ?? record?.status ?? record?.DbStatus,
  );

  if (!status) return null;

  return {
    interactionId,
    filePath,
    status,
    storageClass: null,
    message:
      status === "retrieved"
        ? "The call is ready to play."
        : status === "retrieving"
          ? "The call is being restored from Glacier."
          : "The call must be restored before playback.",
    requestedAt: record?.RequestedAt ?? record?.requestedat ?? null,
    nextCheckAt: record?.NextCheckAt ?? record?.nextcheckat ?? null,
  };
}
async function getStatusForItem(item, skipS3 = false) {
  const interactionId = normalizeInteractionId(
    item?.interactionId ?? item?.id ?? item?.interaction_id,
  );
  const filePath = String(item?.filePath ?? item?.fileLocation ?? "").trim();
  const fileSourceType = item?.fileSourceType ?? item?.file_source_type ?? "";

  if (!interactionId || !filePath) {
    return {
      interactionId: interactionId || item?.interactionId || null,
      filePath,
      status: "unsupported",
      message: "Interaction id or file path is missing.",
    };
  }

  if (resolveSourceType(fileSourceType, filePath) !== "aws-s3") {
    return {
      interactionId,
      filePath,
      status: "retrieved",
      message: "The call is ready to play.",
    };
  }

  const trackedRecord = await readRestoreRecord({ interactionId, filePath });
  const trackedResponse = buildTrackedStatusResponse({
    interactionId,
    filePath,
    record: trackedRecord,
  });

  if (trackedResponse) {
    if (trackedResponse.status === "retrieving") {
      const nextCheckStr = trackedRecord?.NextCheckAt ?? trackedRecord?.nextcheckat;
      const nextCheck = nextCheckStr ? new Date(nextCheckStr) : null;
      const now = new Date();

      if (!skipS3 && (!nextCheck || nextCheck < now)) {
        try {
          const actualS3Status = await getObjectRestoreStatus({ filePath, fileSourceType });
          if (actualS3Status && actualS3Status.status !== "retrieving") {
            await writeRestoreRecord({
              interactionId,
              filePath,
              status: actualS3Status.status,
            });
            trackedResponse.status = actualS3Status.status;
            trackedResponse.message = actualS3Status.message;
          } else {
            // Still retrieving: throttle the next check to protect S3 API costs
            await executeStoredProcedure("usp_updateglacierrestorenextcheckat", {
              interactionid: Number(interactionId),
              payloadtype: "AUDIO",
              status: "",
              interval_minutes: 30,
            });
          }
        } catch (err) {
          console.error("Failed to dynamically check S3 restore status for item:", interactionId, err.message);
        }
      }
    }
    return trackedResponse;
  }

  // If no record exists in the database, we default it to needs_retrieval (Restore)
  // since all calls are in Glacier by default.
  return {
    interactionId,
    filePath,
    status: "needs_retrieval",
    storageClass: null,
    message: "The call must be restored before playback.",
  };
}

export async function POST(req) {
  try {
    if (!verifyAuth(req)) {
      await logWarning(
        "POST /api/interactions/glacierStatus",
        "Unauthorized access attempt",
      );
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const action = String(body?.action || "status").toLowerCase();
    const createdBy = req.headers.get("loggedinuserid") || req.headers.get("loggedInUserId") || null;

    if (action === "restore") {
      const interactionId = normalizeInteractionId(
        body?.interactionId ?? body?.id ?? body?.interaction_id,
      );
      const filePath = String(
        body?.filePath ?? body?.fileLocation ?? "",
      ).trim();

      if (!interactionId || !filePath) {
        return NextResponse.json(
          { message: "interactionId and filePath are required." },
          { status: 400 },
        );
      }

      const result = await initiateObjectRestore({
        interactionId,
        filePath,
        fileSourceType: body?.fileSourceType ?? body?.file_source_type,
        createdBy,
      });

      return NextResponse.json({
        interactionId,
        filePath,
        ...result,
      });
    }

    if (action === "restorebatch") {
      const items = Array.isArray(body?.items) ? body.items : [];
      if (!items.length) {
        return NextResponse.json({ results: [] });
      }

      const results = await Promise.all(
        items.slice(0, 100).map(async (item) => {
          const interactionId = normalizeInteractionId(
            item?.interactionId ?? item?.id ?? item?.interaction_id,
          );
          const filePath = String(
            item?.filePath ?? item?.fileLocation ?? "",
          ).trim();
          const fileSourceType = item?.fileSourceType ?? item?.file_source_type;

          if (!interactionId || !filePath) {
            return {
              interactionId: interactionId || item?.interactionId || null,
              filePath,
              status: "error",
              message: "Interaction id or file path is missing.",
            };
          }

          try {
            const result = await initiateObjectRestore({
              interactionId,
              filePath,
              fileSourceType,
              createdBy,
            });
            return { interactionId, filePath, ...result };
          } catch (err) {
            console.error("restoreBatch item failed:", interactionId, err);
            return {
              interactionId,
              filePath,
              status: "error",
              message: err.message || "Failed to start restore.",
            };
          }
        }),
      );

      return NextResponse.json({ results });
    }

    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) {
      return NextResponse.json({ statuses: [] });
    }

    const isBatch = items.length > 1;
    const statuses = await Promise.all(
      items.slice(0, 100).map((item) => getStatusForItem(item, isBatch)),
    );

    return NextResponse.json({ statuses });
  } catch (error) {
    await logError("POST /api/interactions/glacierStatus", error);
    return NextResponse.json(
      { message: "Failed to read Glacier status." },
      { status: 500 },
    );
  }
}
