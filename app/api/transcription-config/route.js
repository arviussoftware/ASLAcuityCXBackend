// app/api/transcription-config/route.js
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
  connectToDatabase,
} from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

// In-memory cache: key = "platformId:appId:...", value = { config, cachedAt }
// Short TTL — rules change infrequently but we don't want stale "none" blocking pending interactions
const configCache = new Map();
const CACHE_TTL_MS = 10 * 1000; // 10 seconds

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization");
    if (
      !auth?.startsWith("Bearer ") ||
      auth.split(" ")[1] !== API_SECRET_TOKEN
    ) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const appId = searchParams.get("appId");
    const bustCache = searchParams.get("bust") === "1";
    // Interaction-level filter params (optional)
    const ani = searchParams.get("ani") || null;
    const dnis = searchParams.get("dnis") || null;
    const extension = searchParams.get("extension") || null;
    const duration = searchParams.get("duration") || null;
    const orgId = searchParams.get("orgId") || null;
    const customValue = searchParams.get("customValue") || null;

    if (isInvalid(appId)) {
      return NextResponse.json(
        { message: "appId is required." },
        { status: 400 },
      );
    }

    // Cache key includes interaction params so different interactions get correct rules
    const cacheKey = `${appId}:${ani}:${dnis}:${extension}:${duration}:${orgId}:${customValue}`;
    if (!bustCache) {
      const cached = configCache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return NextResponse.json(cached.config, { status: 200 });
      }
    }

    let result = null;
    try {
      result = await executeStoredProcedure(
        "usp_GetTranscriptionConfig",
        {
          appId: Number(appId),
          ani,
          dnis,
          extension,
          duration: duration ? Number(duration) : null,
          orgId: orgId ? Number(orgId) : null,
          customValue,
        },
        outputmsgWithStatusCodeParams,
      );
    } catch (spErr) {
      logWarning(
        "GET /api/transcription-config",
        "GetTranscriptionConfig SP failed, using direct query",
        { appId, error: spErr.message },
      );
      const pool = await connectToDatabase();
      const dbRes = await pool.query(
        `
        SELECT 
          t."NoTranscription",
          t."Import",
          t."NewSTT",
          tp."Provider_name",
          t."SDK" AS "STTEngine",
          t."ApiKey",
          t."LanguageId",
          'English' AS "Language"
        FROM public.tblmst_transcriptionimport t
        LEFT JOIN public.tblmst_transcription_provider tp ON (CASE WHEN t."SDK" ~ '^[0-9]+$' THEN CAST(t."SDK" AS INTEGER) ELSE NULL END) = tp."Id"
        WHERE t."PlatformId" = $1
        LIMIT 1
      `,
        [Number(appId)],
      );

      result = {
        recordset: dbRes.rows,
        recordsets: [dbRes.rows],
        output: { statuscode: 200, outputmsg: "Success" },
      };
    }

    // No config row → treat as no transcription
    if (!result.recordset?.length) {
      return NextResponse.json({ mode: "none" }, { status: 200 });
    }

    const row = result.recordset[0];

    // Priority: NoTranscription=1 → none | Import=1 → import | NewSTT=1 → stt
    let mode = "none";
    if (row.NoTranscription) mode = "none";
    else if (row.Import) mode = "import";
    else if (row.NewSTT) mode = "stt";

    const config = {
      mode,
      // Provider_name comes from the SP join on tblmst_Transcription_provider
      // SDK column stores numeric ID (1=Google, 2=AWS, 3=Azure, 4=AssemblyAI)
      sdk: row.Provider_name || null,
      languageId: row.LanguageId || 1,
      language: row.Language || "English",
      // apiKey is intentionally NOT returned — transcription-generate fetches it server-side
    };

    await logSuccess(
      "GET /api/transcription-config",
      "Transcription config resolved successfully.",
      {
        appId,
        mode,
        sdk: config.sdk,
      },
    );

    configCache.set(cacheKey, { config, cachedAt: Date.now() });
    return NextResponse.json(config, { status: 200 });
  } catch (err) {
    logError("GET /api/transcription-config", err);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 },
    );
  }
}
