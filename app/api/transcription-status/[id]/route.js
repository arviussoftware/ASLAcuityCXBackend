// app/api/transcription-status/[id]/route.js
// Lightweight poll endpoint — returns current transcription state for one interaction.
// Used by the UI to check if a PROCESSING transcription has completed.

import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/sql.js";
import { logError } from "@/lib/errorLogger";
import { assertSafeTableName } from "@/lib/safeTableName";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request, { params }) {
  try {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer ") || auth.split(" ")[1] !== API_SECRET_TOKEN) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ message: "id is required" }, { status: 400 });
    }

    const pool = await connectToDatabase();
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: currentYear - 2022 + 2 }, (_, i) => currentYear + 1 - i);
    const tables = years.map((y) => `TblMst_Metadata_${y}`);
    let row = null;

    for (const tableName of tables) {
      try {
        assertSafeTableName(tableName);
        const result = await pool.query(`
          SELECT
            transcriptionfilepath,
            transcription_source_type,
            transcription_status,
            transcription_error
          FROM public."${tableName}"
          WHERE CAST(interaction_id AS VARCHAR) = $1
          LIMIT 1
        `, [String(id)]);
        if (result.rows && result.rows.length > 0) {
          row = result.rows[0];
          break;
        }
      } catch (tableErr) {
        // Ignore and try next table
      }
    }

    if (!row) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }

    const path   = row.transcriptionfilepath || null;
    let dbStat = "";
    if (row.transcription_status !== null && row.transcription_status !== undefined) {
      if (row.transcription_status === 1 || row.transcription_status === "1") dbStat = "PROCESSING";
      else if (row.transcription_status === 2 || row.transcription_status === "2") dbStat = "COMPLETED";
      else if (row.transcription_status === 3 || row.transcription_status === "3") dbStat = "FAILED";
      else dbStat = String(row.transcription_status).toUpperCase();
    }
    const dbErr  = row.transcription_error || null;

    // Classify the status into what the UI understands
    let status;
    if (dbStat === "COMPLETED" || (path && !path.startsWith("ERROR:") && path !== "PROCESSING")) {
      status = "completed";
    } else if (dbStat === "FAILED" || (path && path.startsWith("ERROR:"))) {
      status = "failed";
    } else if (dbStat === "PROCESSING" || path === "PROCESSING") {
      status = "processing";
    } else {
      status = "pending";
    }

    return NextResponse.json({
      status,
      transcriptionfilepath:     status === "completed" ? path : null,
      transcription_source_type: status === "completed" ? (row.transcription_source_type || null) : null,
      errorCode: status === "failed" ? (dbErr || (path?.startsWith("ERROR:") ? path.slice(6) : "UNKNOWN_ERROR")) : null,
    });
  } catch (err) {
    logError("api/transcription-status/[id] GET id=" + id, err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
