import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/sql.js";
import { logAudit } from "@/lib/auditLogger";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

/** Max characters allowed per annotation note text */
const MAX_ANNOTATION_LENGTH = 2000;

/**
 * Validates that every note in saved/dragged arrays respects the length cap.
 * Returns { valid: true } or { valid: false, message: string }.
 */
function validateNoteLengths(saved = [], dragged = []) {
  for (const note of [...saved, ...dragged]) {
    const text = note?.annotation ?? "";
    if (typeof text !== "string") {
      return { valid: false, message: "Annotation text must be a string." };
    }
    if (text.length > MAX_ANNOTATION_LENGTH) {
      return {
        valid: false,
        message: `Annotation text exceeds the maximum allowed length of ${MAX_ANNOTATION_LENGTH} characters.`,
      };
    }
  }
  return { valid: true };
}

function authError() {
  return NextResponse.json(
    { success: false, message: "Unauthorized" },
    { status: 401 },
  );
}
function toIntStr(val) {
  const s = String(val ?? "")
    .trim()
    .replace(/[^0-9]/g, "");
  return s || "0";
}
function toInt(val) {
  return parseInt(toIntStr(val), 10) || 0;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Schema (one row per user per interaction):
   DB columns : id, interaction_id, call_id, annotation (JSON), created_by,
                created_date, Modify_by, modified_date

   JSON blob  : {
     interactionId, callId,
     saved:   [ { annotation, recordingTimestampPoint, recordingTimestampRaw,
                  createdBy, createdAt, modifiedBy, modifiedAt } ],
     dragged: [ { annotation,
                  recordingTimestampStarted, recordingTimestampStartedRaw,
                  recordingTimestampEnded,   recordingTimestampEndedRaw,
                  createdBy, createdAt, modifiedBy, modifiedAt } ]
   }
 ───────────────────────────────────────────────────────────────────────────── */

/* ── GET ── */
export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
    logWarning("GET /api/annotations", "Unauthorized access attempt", {
      url: request.url,
    });
    return authError();
  }

  const { searchParams } = new URL(request.url);
  const interactionId = toIntStr(searchParams.get("interactionId"));
  const userId = toIntStr(searchParams.get("userId"));
  const viewAll = searchParams.get("viewAll") === "1";

  if (!interactionId || interactionId === "0") {
    logWarning("GET /api/annotations", "Missing/invalid interactionId", {
      url: request.url,
    });
    return NextResponse.json(
      { success: false, message: "interactionId required" },
      { status: 400 },
    );
  }
  if (!userId || userId === "0") {
    logWarning("GET /api/annotations", "Missing/invalid userId", {
      url: request.url,
    });
    return NextResponse.json(
      { success: false, message: "userId required" },
      { status: 400 },
    );
  }

  try {
    const pool = await connectToDatabase();
    let rows = [];

    const where = viewAll ? "" : `AND a.created_by = $2`;
    const result = await pool.query(
      `
      SELECT
        a.id,
        a.interaction_id,
        a.call_id,
        a.annotation,
        a.created_by,
        a.created_date,
        a.modify_by     AS modified_by,
        a.modified_date,
        COALESCE(uc.user_login_id, CAST(a.created_by AS VARCHAR)) AS creator_name,
        COALESCE(um.user_login_id, CAST(a.modify_by  AS VARCHAR)) AS modifier_name
      FROM public.tblmst_annotationtable a
      LEFT JOIN public.tblmst_userdetails uc ON uc."userId" = a.created_by AND COALESCE(uc."DeleteStatus", 0) = 0
      LEFT JOIN public.tblmst_userdetails um ON um."userId" = a.modify_by AND COALESCE(um."DeleteStatus", 0) = 0
      WHERE a.interaction_id = $1 ${where}
      ORDER BY a.created_date DESC
    `,
      viewAll ? [interactionId] : [interactionId, userId],
    );
    rows = result.rows;

    // ── Resolve user IDs inside JSON blobs to names ──────────────────────
    const idSet = new Set();
    for (const row of rows) {
      let blob = {};
      try {
        blob =
          typeof row.annotation === "string"
            ? JSON.parse(row.annotation)
            : row.annotation;
      } catch (_) {}
      for (const n of [...(blob.saved ?? []), ...(blob.dragged ?? [])]) {
        if (n.createdBy && /^\d+$/.test(String(n.createdBy)))
          idSet.add(String(n.createdBy));
        if (n.modifiedBy && /^\d+$/.test(String(n.modifiedBy)))
          idSet.add(String(n.modifiedBy));
      }
    }

    const userMap = {};
    if (idSet.size > 0) {
      const idList = [...idSet];
      const usersRes = await pool.query(
        `
        SELECT "userId" AS userid, user_login_id
        FROM public.tblmst_userdetails
        WHERE "userId" = ANY($1::int[])
          AND COALESCE("DeleteStatus", 0) = 0
      `,
        [idList.map(Number)],
      );
      for (const u of usersRes.rows) {
        userMap[String(u.userid)] = u.user_login_id || String(u.userid);
      }
    }

    // Rewrite note-level IDs → names in the returned rows
    const annotations = rows.map((row) => {
      let blob = {};
      try {
        blob =
          typeof row.annotation === "string"
            ? JSON.parse(row.annotation)
            : row.annotation;
      } catch (_) {}

      const resolveName = (val) => {
        if (!val) return val;
        const s = String(val);
        return /^\d+$/.test(s) ? (userMap[s] ?? s) : s;
      };

      const resolveNote = (n) => ({
        ...n,
        createdBy: resolveName(n.createdBy),
        modifiedBy: resolveName(n.modifiedBy),
      });

      const resolvedBlob = {
        ...blob,
        saved: (blob.saved ?? []).map(resolveNote),
        dragged: (blob.dragged ?? []).map(resolveNote),
      };

      return { ...row, annotation: JSON.stringify(resolvedBlob) };
    });

    await logSuccess(
      "GET /api/annotations",
      "Annotations fetched successfully.",
      {
        interactionId,
        userId,
        viewAll,
        count: annotations.length,
      },
    );

    return NextResponse.json({ success: true, annotations });
  } catch (err) {
    logError("api/annotations GET interactionId=" + interactionId, err, {
      userId,
      viewAll,
    });
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── POST ── */
export async function POST(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
    logWarning("POST /api/annotations", "Unauthorized access attempt", {
      url: request.url,
    });
    return authError();
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    logWarning("POST /api/annotations", "Invalid JSON body", {
      url: request.url,
    });
    return NextResponse.json(
      { success: false, message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const {
    interaction_id,
    created_by,
    userName = "unknown",
    existing_id,
    // canEditAny is intentionally ignored — privilege is verified server-side below
    annotation,
  } = body ?? {};

  const iid = toIntStr(interaction_id);
  const userId = toInt(created_by);
  const now = new Date().toISOString();

  if (!iid || iid === "0") {
    logWarning("POST /api/annotations", "interaction_id is required", { body });
    return NextResponse.json(
      { success: false, message: "interaction_id is required" },
      { status: 400 },
    );
  }
  if (!userId) {
    logWarning("POST /api/annotations", "created_by is required", { body });
    return NextResponse.json(
      { success: false, message: "created_by is required" },
      { status: 400 },
    );
  }

  const inSaved = Array.isArray(annotation?.saved) ? annotation.saved : [];
  const inDragged = Array.isArray(annotation?.dragged)
    ? annotation.dragged
    : [];
  if (!inSaved.length && !inDragged.length) {
    logWarning("POST /api/annotations", "annotation notes are required", {
      interaction_id,
      created_by,
    });
    return NextResponse.json(
      { success: false, message: "annotation notes are required" },
      { status: 400 },
    );
  }

  // ── Annotation text length guard ────────────────────────────────────────
  const lengthCheck = validateNoteLengths(inSaved, inDragged);
  if (!lengthCheck.valid) {
    logWarning("POST /api/annotations", "Annotation length validation failed", {
      interaction_id,
      created_by,
      error: lengthCheck.message,
    });
    return NextResponse.json(
      { success: false, message: lengthCheck.message },
      { status: 400 },
    );
  }

  // ── Server-side privilege check for edit-any ─────────────────────────────
  // Replaces the client-supplied `canEditAny` flag — the DB is the authority.
  const canEditAll = await checkUserPrivilege(
    userId,
    MODULES.INTERACTION,
    PRIVILEGES.EDIT_ANNOTATION,
  );

  try {
    const pool = await connectToDatabase();

    // ── Resolve userId → login name for storing in blob ──────────────────
    let userLoginName = userName;
    try {
      const uRes = await pool.query(
        `SELECT user_login_id FROM public.tblmst_userdetails WHERE "userId" = $1 AND COALESCE("DeleteStatus", 0) = 0`,
        [userId],
      );
      if (uRes.rows[0]?.user_login_id)
        userLoginName = uRes.rows[0].user_login_id;
    } catch (_) {}

    // Resolve call_id
    let call_id = String(annotation?.callId ?? "");
    try {
      const currentYear = new Date().getFullYear();
      const years = Array.from(
        { length: currentYear - 2022 + 2 },
        (_, i) => currentYear + 1 - i,
      );
      const tables = years.map((y) => `TblMst_Metadata_${y}`);
      for (const tableName of tables) {
        try {
          const m = await pool.query(
            `SELECT call_id FROM public."${tableName}" WHERE interaction_id = $1 LIMIT 1`,
            [iid],
          );
          if (m.rows[0]?.call_id) {
            call_id = String(m.rows[0].call_id);
            break;
          }
        } catch (_) {}
      }
    } catch (_) {}

    // ── Stamp each note with createdBy / modifiedBy ──────────────────────
    const existingRowId = toIntStr(existing_id);
    let rowId = existingRowId && existingRowId !== "0" ? existingRowId : null;
    let prevJson = null;

    if (!rowId) {
      const lookup = await pool.query(
        `
        SELECT id, annotation, created_by
        FROM public.tblmst_annotationtable
        WHERE interaction_id = $1 AND created_by = $2
        ORDER BY created_date DESC
        LIMIT 1
      `,
        [iid, userId],
      );
      if (lookup.rows[0]) {
        rowId = String(lookup.rows[0].id);
        prevJson = lookup.rows[0].annotation;
      }
    } else {
      const lookup = await pool.query(
        `
        SELECT annotation, created_by FROM public.tblmst_annotationtable
        WHERE id = $1 AND interaction_id = $2
      `,
        [rowId, iid],
      );
      if (!lookup.rows[0]) {
        rowId = null;
      } else {
        if (
          !canEditAll &&
          String(lookup.rows[0].created_by) !== String(userId)
        ) {
          logWarning(
            "POST /api/annotations",
            "Forbidden annotation edit attempt",
            {
              interactionId: iid,
              requestUserId: userId,
              existingCreatorId: lookup.rows[0].created_by,
              rowId,
            },
          );
          return NextResponse.json(
            { success: false, message: "Forbidden" },
            { status: 403 },
          );
        }
        prevJson = lookup.rows[0].annotation;
      }
    }

    let prevBlob = { saved: [], dragged: [] };
    if (prevJson) {
      try {
        prevBlob =
          typeof prevJson === "string" ? JSON.parse(prevJson) : prevJson;
      } catch (_) {}
    }
    const prevSaved = Array.isArray(prevBlob.saved) ? prevBlob.saved : [];
    const prevDragged = Array.isArray(prevBlob.dragged) ? prevBlob.dragged : [];

    const stampNew = (n) => ({
      ...n,
      createdBy: n.createdBy ?? userLoginName,
      createdAt: now,
      modifiedBy: null,
      modifiedAt: null,
    });

    const stampEdit = (prev, n) => {
      const textChanged =
        (prev.annotation ?? "").trim() !== (n.annotation ?? "").trim();
      return {
        ...n,
        createdBy: prev.createdBy ?? n.createdBy ?? userLoginName,
        createdAt: prev.createdAt ?? now,
        modifiedBy: textChanged ? userLoginName : (prev.modifiedBy ?? null),
        modifiedAt: textChanged ? now : (prev.modifiedAt ?? null),
      };
    };

    const matchedSavedIdx = new Set();
    const matchedDraggedIdx = new Set();

    const newSaved = inSaved.map((incoming) => {
      const idx = prevSaved.findIndex(
        (p, i) =>
          !matchedSavedIdx.has(i) &&
          Math.abs(
            (p.recordingTimestampRaw ?? 0) -
              (incoming.recordingTimestampRaw ?? 0),
          ) < 0.05,
      );
      if (idx !== -1) {
        matchedSavedIdx.add(idx);
        return stampEdit(prevSaved[idx], incoming);
      }
      return stampNew(incoming);
    });

    const newDragged = inDragged.map((incoming) => {
      const idx = prevDragged.findIndex(
        (p, i) =>
          !matchedDraggedIdx.has(i) &&
          Math.abs(
            (p.recordingTimestampStartedRaw ?? 0) -
              (incoming.recordingTimestampStartedRaw ?? 0),
          ) < 0.05 &&
          Math.abs(
            (p.recordingTimestampEndedRaw ?? 0) -
              (incoming.recordingTimestampEndedRaw ?? 0),
          ) < 0.05,
      );
      if (idx !== -1) {
        matchedDraggedIdx.add(idx);
        return stampEdit(prevDragged[idx], incoming);
      }
      return stampNew(incoming);
    });

    const keptSaved = prevSaved.filter((_, i) => !matchedSavedIdx.has(i));
    const keptDragged = prevDragged.filter((_, i) => !matchedDraggedIdx.has(i));

    const mergedSaved = [...keptSaved, ...newSaved];
    const mergedDragged = [...keptDragged, ...newDragged];

    const newBlobJson = JSON.stringify({
      interactionId: iid,
      callId: call_id,
      savedAt: now,
      saved: mergedSaved,
      dragged: mergedDragged,
    });

    let resultId;
    let actionType;

    if (rowId) {
      let auditArr = [];
      try {
        const curAudit = await pool.query(
          `SELECT auditlog, annotation FROM public.tblmst_annotationtable WHERE id = $1`,
          [rowId],
        );
        const rawAudit = curAudit.rows[0]?.auditlog;
        const rawBlob = curAudit.rows[0]?.annotation;

        if (rawAudit) {
          try {
            auditArr =
              typeof rawAudit === "string" ? JSON.parse(rawAudit) : rawAudit;
          } catch (_) {}
          if (!Array.isArray(auditArr)) auditArr = [];
        }

        if (rawBlob) {
          let oldBlob = {};
          try {
            oldBlob =
              typeof rawBlob === "string" ? JSON.parse(rawBlob) : rawBlob;
          } catch (_) {}
          const oldSaved = Array.isArray(oldBlob.saved) ? oldBlob.saved : [];
          const oldDragged = Array.isArray(oldBlob.dragged)
            ? oldBlob.dragged
            : [];

          const baseCtx = {
            rowId: parseInt(rowId, 10),
            interactionId: iid,
            callId: call_id,
            by: userLoginName,
            userId,
            at: now,
          };

          const diffNotes = (oldArr, newArr, type) => {
            const tsKey =
              type === "saved"
                ? "recordingTimestampRaw"
                : "recordingTimestampStartedRaw";
            const label = (n) =>
              type === "saved"
                ? (n.recordingTimestampPoint ?? String(n.recordingTimestampRaw))
                : `${n.recordingTimestampStarted ?? ""} – ${n.recordingTimestampEnded ?? ""}`;

            for (const n of newArr) {
              const ts = n[tsKey] ?? 0;
              const prev = oldArr.find(
                (p) => Math.abs((p[tsKey] ?? 0) - ts) < 0.05,
              );
              if (!prev) {
                auditArr.push({
                  ...baseCtx,
                  action: "created",
                  noteType: type,
                  recordingAt: label(n),
                  note: n.annotation,
                  createdBy: n.createdBy ?? userLoginName,
                });
              } else if (
                (prev.annotation ?? "").trim() !== (n.annotation ?? "").trim()
              ) {
                auditArr.push({
                  ...baseCtx,
                  action: "edited",
                  noteType: type,
                  recordingAt: label(n),
                  previousNote: prev.annotation,
                  newNote: n.annotation,
                  originalCreator: prev.createdBy ?? null,
                  originalCreatedAt: prev.createdAt ?? null,
                });
              }
            }
            for (const p of oldArr) {
              const ts = p[tsKey] ?? 0;
              const still = newArr.find(
                (n) => Math.abs((n[tsKey] ?? 0) - ts) < 0.05,
              );
              if (!still) {
                auditArr.push({
                  ...baseCtx,
                  action: "deleted",
                  noteType: type,
                  recordingAt: label(p),
                  note: p.annotation,
                  originalCreator: p.createdBy ?? null,
                  originalCreatedAt: p.createdAt ?? null,
                });
              }
            }
          };

          diffNotes(oldSaved, mergedSaved, "saved");
          diffNotes(oldDragged, mergedDragged, "dragged");
        }
      } catch (auditErr) {
        logWarning("POST /api/annotations", "Annotation auditlog diff failed", {
          interactionId: iid,
          error: auditErr.message,
        });
      }
      const newAudit = JSON.stringify(auditArr);

      await pool.query(
        `
        UPDATE public.tblmst_annotationtable
        SET annotation    = $1,
            auditlog      = $2,
            modify_by     = $3,
            modified_date = NOW()
        WHERE id = $4 AND interaction_id = $5
      `,
        [newBlobJson, newAudit, userId, rowId, iid],
      );

      resultId = parseInt(rowId, 10);
      actionType = "ANNOTATION_UPDATED";
    } else {
      const ins = await pool.query(
        `
        INSERT INTO public.tblmst_annotationtable
          (interaction_id, call_id, annotation, created_by, created_date)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING id
      `,
        [iid, call_id, newBlobJson, userId],
      );
      resultId = ins.rows[0]?.id;
      actionType = "ANNOTATION_CREATED";
    }

    await logAudit({
      userId,
      userName,
      actionType,
      description: `User ${userId} ${actionType === "ANNOTATION_CREATED" ? "created" : "updated"} annotations on interaction ${iid}`,
    });

    await logSuccess(
      "POST /api/annotations",
      `Annotation ${actionType === "ANNOTATION_CREATED" ? "created" : "updated"} successfully.`,
      { interactionId: iid, createdBy: userId, id: resultId },
    );

    return NextResponse.json({ success: true, id: resultId });
  } catch (err) {
    logError("api/annotations POST iid=" + iid, err);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ── DELETE ── */
export async function DELETE(request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
    logWarning("DELETE /api/annotations", "Unauthorized access attempt", {
      url: request.url,
    });
    return authError();
  }

  const { searchParams } = new URL(request.url);
  const id = toIntStr(searchParams.get("id"));
  const interactionId = toIntStr(searchParams.get("interactionId"));
  const userId = toIntStr(searchParams.get("userId"));
  const userName = searchParams.get("userName") || "unknown";
  // canDeleteAny is intentionally ignored from query params — privilege is verified server-side below
  const noteKey = searchParams.get("noteKey") || null;

  // ── Server-side privilege check for delete-any ───────────────────────────
  // Replaces the client-supplied `canDeleteAny` flag — the DB is the authority.
  const canDeleteAny =
    userId && userId !== "0"
      ? await checkUserPrivilege(
          toInt(userId),
          MODULES.INTERACTION,
          PRIVILEGES.DELETE_ANNOTATION,
        )
      : false;

  if (!id || id === "0") {
    logWarning("DELETE /api/annotations", "id required", { url: request.url });
    return NextResponse.json(
      { success: false, message: "id required" },
      { status: 400 },
    );
  }

  try {
    const pool = await connectToDatabase();

    if (!noteKey) {
      let where = `WHERE id = $1`;
      const params = [id];
      if (interactionId && interactionId !== "0") {
        where += ` AND interaction_id = $2`;
        params.push(interactionId);
      }
      if (!canDeleteAny && userId && userId !== "0") {
        where += ` AND created_by = $${params.length + 1}`;
        params.push(userId);
      }
      await pool.query(
        `DELETE FROM public.tblmst_annotationtable ${where}`,
        params,
      );
    } else {
      const cur = await pool.query(
        `SELECT annotation, created_by FROM public.tblmst_annotationtable WHERE id = $1`,
        [id],
      );

      const record = cur.rows[0];
      if (!record) {
        logWarning("DELETE /api/annotations", "Annotation record not found", {
          id,
        });
        return NextResponse.json(
          { success: false, message: "Not found" },
          { status: 404 },
        );
      }

      const rowOwner = String(record.created_by);
      let blob = { saved: [], dragged: [] };
      try {
        blob =
          typeof record.annotation === "string"
            ? JSON.parse(record.annotation)
            : record.annotation;
      } catch (_) {}

      const deletedNow = new Date().toISOString();
      const deletedNotes = [];
      const filterNote = (arr, key) =>
        arr.filter((n) => {
          const noteOwner = n.createdBy ? String(n.createdBy) : rowOwner;
          if (!canDeleteAny && noteOwner !== String(userId)) return true;
          let isMatch = false;
          if (key.startsWith("s:")) {
            const ts = parseFloat(key.slice(2));
            if (!isFinite(ts)) return true;
            isMatch = Math.abs((n.recordingTimestampRaw ?? 0) - ts) < 0.05;
          } else if (key.startsWith("d:")) {
            const parts = key.split(":");
            if (parts.length < 3) return true;
            const startTs = parseFloat(parts[1]);
            const endTs = parseFloat(parts[2]);
            if (!isFinite(startTs) || !isFinite(endTs)) return true;
            isMatch =
              Math.abs((n.recordingTimestampStartedRaw ?? 0) - startTs) <
                0.05 &&
              Math.abs((n.recordingTimestampEndedRaw ?? 0) - endTs) < 0.05;
          }
          if (isMatch) {
            deletedNotes.push({
              ...n,
              history: [
                ...(Array.isArray(n.history) ? n.history : []),
                {
                  action: "deleted",
                  by: toInt(userId),
                  byName: userName,
                  at: deletedNow,
                },
              ],
            });
            return false;
          }
          return true;
        });

      const newSaved = filterNote(
        Array.isArray(blob.saved) ? blob.saved : [],
        noteKey,
      );
      const newDragged = filterNote(
        Array.isArray(blob.dragged) ? blob.dragged : [],
        noteKey,
      );

      if (!newSaved.length && !newDragged.length) {
        await pool.query(
          `DELETE FROM public.tblmst_annotationtable WHERE id = $1`,
          [id],
        );
      } else {
        const newBlob = JSON.stringify({
          ...blob,
          saved: newSaved,
          dragged: newDragged,
        });
        let auditArr = [];
        try {
          const curAudit = await pool.query(
            `SELECT auditlog FROM public.tblmst_annotationtable WHERE id = $1`,
            [id],
          );
          const raw = curAudit.rows[0]?.auditlog;
          if (raw) {
            try {
              auditArr = typeof raw === "string" ? JSON.parse(raw) : raw;
            } catch (_) {}
          }
          if (!Array.isArray(auditArr)) auditArr = [];
        } catch (_) {}
        auditArr.push(...deletedNotes);
        const newAudit = JSON.stringify(auditArr);

        await pool.query(
          `
          UPDATE public.tblmst_annotationtable
          SET annotation = $1,
              auditlog   = $2,
              modify_by  = $3,
              modified_date = NOW()
          WHERE id = $4
        `,
          [newBlob, newAudit, userId, id],
        );
      }
    }

    await logAudit({
      userId: toInt(userId),
      userName,
      actionType: "ANNOTATION_DELETED",
      description: `User ${userId} deleted annotation note (key: ${noteKey ?? "row"}) on interaction ${interactionId}`,
    });

    await logSuccess(
      "DELETE /api/annotations",
      "Annotation deleted successfully.",
      {
        id,
        interactionId,
        userId,
        noteKey: noteKey ?? "row",
      },
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    logError("api/annotations DELETE id=" + id, err, {
      interactionId,
      userId,
      noteKey,
    });
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
