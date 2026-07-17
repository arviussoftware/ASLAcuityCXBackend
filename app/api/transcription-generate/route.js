// app/api/transcription-generate/route.js — v2
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
  connectToDatabase,
} from "@/lib/sql.js";
import fs from "fs";
import path from "path";
import { Storage } from "@google-cloud/storage";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
} from "@aws-sdk/client-transcribe";
import { getAWSCredentials } from "@/lib/connectionCredentials";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { assertSafeTableName } from "@/lib/safeTableName";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

/* ── Resolve source type from path prefix — DB value is fallback only ── */
function resolveSourceType(filePath, dbSourceType) {
  if (filePath.startsWith("s3://")) return "aws-s3";
  if (filePath.startsWith("gs://")) return "gcp";
  if (
    filePath.startsWith("https://storage.googleapis.com/") ||
    filePath.startsWith("https://storage.cloud.google.com/")
  )
    return "gcp";
  if (filePath.startsWith("https://") || filePath.startsWith("http://"))
    return "public-url";
  if (filePath.startsWith("\\\\")) return "network";
  const t = (dbSourceType || "").toLowerCase().trim();
  if (["aws-s3", "gcp", "network", "local"].includes(t)) return t;
  return "local";
}

/* ── Path traversal guard ── */
function validateFilePath(filePath) {
  if (
    filePath.startsWith("s3://") ||
    filePath.startsWith("gs://") ||
    filePath.startsWith("http://") ||
    filePath.startsWith("https://")
  )
    return true;
  const normalized = path.normalize(filePath);
  if (normalized.includes("..")) return false;
  if (!path.isAbsolute(normalized) && !normalized.startsWith("\\\\"))
    return false;
  return true;
}

/* ── Robust helper to update transcription details in DB with SP fallback ── */
async function updateTranscriptionInDB(interactionId, fields) {
  if (!interactionId) return;
  try {
    // Attempt using stored procedure first
    await executeStoredProcedure(
      "usp_UpdateInteractionTranscription",
      {
        interactionId: String(interactionId),
        transcriptionfilepath: fields.transcriptionfilepath || null,
        transcription_status: fields.transcription_status || null,
        transcription_source_type: fields.transcription_source_type || null,
        transcription_error: fields.transcription_error || null,
      },
      outputmsgWithStatusCodeParams,
    );
  } catch (spErr) {
    logWarning(
      "updateTranscriptionInDB",
      "Update SP failed, trying raw query fallback",
      { interactionId, error: spErr.message },
    );
    // Fallback: update partitioned tables directly
    const pool = await connectToDatabase();
    const currentYear = new Date().getFullYear();
    const years = Array.from(
      { length: currentYear - 2022 + 2 },
      (_, i) => currentYear + 1 - i,
    );
    const tables = years.map((y) => `TblMst_Metadata_${y}`);

    const statusInt =
      fields.transcription_status === "PROCESSING"
        ? 1
        : fields.transcription_status === "COMPLETED"
          ? 2
          : fields.transcription_status === "FAILED"
            ? 3
            : null;

    for (const tableName of tables) {
      try {
        assertSafeTableName(tableName);
        const result = await pool.query(
          `
          UPDATE public."${tableName}"
          SET 
            transcriptionfilepath = $1,
            transcription_status = $2,
            transcription_source_type = $3,
            transcription_error = $4
          WHERE CAST(interaction_id AS VARCHAR(100)) = $5
          RETURNING interaction_id
        `,
          [
            fields.transcriptionfilepath || null,
            statusInt,
            fields.transcription_source_type || null,
            fields.transcription_error || null,
            String(interactionId),
          ],
        );

        if (result.rows && result.rows.length > 0) {
          logWarning(
            "updateTranscriptionInDB",
            `Updated transcription in ${tableName} for ${interactionId}`,
            {},
          );
          break;
        }
      } catch (tableErr) {
        // Table or columns error — try next
        logWarning(
          "updateTranscriptionInDB",
          `Failed to update table ${tableName}`,
          { interactionId, error: tableErr.message },
        );
      }
    }
  }
}

/* ── Write failure status to DB so the interaction doesn't retry forever ── */
async function markFailed(interactionId, errorCode, errorMessage) {
  await updateTranscriptionInDB(interactionId, {
    transcriptionfilepath: `ERROR:${errorCode}`,
    transcription_status: "FAILED",
    transcription_source_type: "none",
    transcription_error: String(errorMessage || errorCode).slice(0, 500),
  });
}

/* ── Classify raw error into a user-friendly code + message ── */
function classifyError(err) {
  const msg = (err.message || "").toLowerCase();

  if (msg.startsWith("file_too_large:"))
    return {
      code: "FILE_TOO_LARGE",
      message: err.message.slice(15),
      retryable: false,
    };

  if (msg.startsWith("skip:"))
    return {
      code: "PERMANENT_SKIP",
      message: err.message.slice(5),
      retryable: false,
    };

  if (
    msg.includes("audio file not found") ||
    msg.includes("enoent") ||
    msg.includes("no such file")
  )
    return {
      code: "AUDIO_NOT_FOUND",
      message:
        "Audio file not found. The recording may have been moved or deleted.",
      retryable: false,
    };

  if (msg.includes("no transcription config") || msg.includes("config found"))
    return {
      code: "NO_RULE",
      message:
        "No transcription rule found for this interaction. Create a matching rule in Integration Workspace → Transcription.",
      retryable: false,
    };

  if (msg.includes("does not match any enabled"))
    return {
      code: "RULE_MISMATCH",
      message:
        "This interaction does not match any enabled transcription rule. Check ANI, DNIS, extension, duration, and organization filters.",
      retryable: false,
    };

  if (
    msg.includes("api key") ||
    msg.includes("unauthorized") ||
    msg.includes("401") ||
    msg.includes("invalid api")
  )
    return {
      code: "INVALID_API_KEY",
      message:
        "STT engine API key is invalid or expired. Update the key in Integration Workspace → Transcription.",
      retryable: false,
    };

  if (
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("too many requests")
  )
    return {
      code: "RATE_LIMIT",
      message:
        "STT engine rate limit reached. Please wait a few minutes and retry.",
      retryable: true,
    };

  if (msg.includes("timed out") || msg.includes("timeout"))
    return {
      code: "STT_TIMEOUT",
      message:
        "STT engine timed out. The audio file may be too long. Try a shorter recording or switch to AWS Transcribe.",
      retryable: true,
    };

  if (msg.includes("whisper") || msg.includes("openai") || msg.includes("groq"))
    return {
      code: "STT_ENGINE_ERROR",
      message: `OpenAI Whisper error: ${err.message}`,
      retryable: true,
    };

  if (msg.includes("assemblyai") || msg.includes("assembly"))
    return {
      code: "STT_ENGINE_ERROR",
      message: `AssemblyAI error: ${err.message}`,
      retryable: true,
    };

  if (msg.includes("google") || msg.includes("speech.googleapis"))
    return {
      code: "STT_ENGINE_ERROR",
      message: `Google STT error: ${err.message}`,
      retryable: true,
    };

  if (
    msg.includes("aws") ||
    msg.includes("transcribe") ||
    msg.includes("amazon")
  )
    return {
      code: "STT_ENGINE_ERROR",
      message: `AWS Transcribe error: ${err.message}`,
      retryable: true,
    };

  if (msg.includes("azure") || msg.includes("microsoft"))
    return {
      code: "STT_ENGINE_ERROR",
      message: `Azure Speech error: ${err.message}`,
      retryable: true,
    };

  if (
    msg.includes("unsupported file type") ||
    msg.includes("unsupported format")
  )
    return {
      code: "UNSUPPORTED_FORMAT",
      message: err.message,
      retryable: false,
    };

  if (
    msg.includes("network") ||
    msg.includes("econnrefused") ||
    msg.includes("fetch failed") ||
    msg.includes("enotfound")
  )
    return {
      code: "NETWORK_ERROR",
      message:
        "Network error reaching STT engine. Check your internet connection and try again.",
      retryable: true,
    };

  if (
    msg.includes("s3") ||
    msg.includes("nosuchkey") ||
    msg.includes("access denied")
  )
    return {
      code: "STORAGE_ERROR",
      message: `Storage access error: ${err.message}`,
      retryable: false,
    };

  return {
    code: "UNKNOWN_ERROR",
    message:
      err.message || "An unexpected error occurred during transcription.",
    retryable: true,
  };
}

export async function POST(request) {
  let body = null;
  try {
    const auth = request.headers.get("authorization");
    if (
      !auth?.startsWith("Bearer ") ||
      auth.split(" ")[1] !== API_SECRET_TOKEN
    ) {
      await logSuccess(
        "POST /api/transcription-generate",
        "Transcription generated and saved successfully.",
        {
          interactionId,
          sdk,
          savedPath: savePath,
        },
      );
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    body = await request.json();
    const {
      interactionId,
      filePath,
      fileSourceType,
      platformId,
      appId,
      ani,
      dnis,
      extension,
      duration,
      orgId,
    } = body;

    if (isInvalid(interactionId) || isInvalid(filePath) || isInvalid(appId)) {
      return NextResponse.json(
        { message: "Missing required fields.", errorCode: "MISSING_FIELDS" },
        { status: 400 },
      );
    }

    // ── Mark PROCESSING immediately — prevents duplicate generation ─────
    await updateTranscriptionInDB(interactionId, {
      transcriptionfilepath: null,
      transcription_status: "PROCESSING",
      transcription_source_type: "none",
    });

    // ── Rule access check ─────────────────────────────────────────────────
    let accessStatusCode = 200;
    try {
      const accessCheck = await executeStoredProcedure(
        "usp_CanTranscribeInteraction",
        { InteractionId: Number(interactionId) },
        outputmsgWithStatusCodeParams,
      );
      accessStatusCode = Number(accessCheck?.output?.statuscode ?? 500);
    } catch (spErr) {
      logWarning(
        "POST /api/transcription-generate",
        "CanTranscribe SP failed, bypassing",
        { error: spErr.message },
      );
      accessStatusCode = 200;
    }

    if (accessStatusCode === 403) {
      const errMsg =
        "This interaction does not match any enabled transcription rule. Check ANI, DNIS, extension, duration, and organization filters in Integration Workspace → Transcription.";
      await markFailed(interactionId, "RULE_MISMATCH", errMsg);
      return NextResponse.json(
        { message: errMsg, errorCode: "RULE_MISMATCH", retryable: false },
        { status: 403 },
      );
    }
    if (accessStatusCode !== 200) {
      const errMsg = "Failed to verify transcription access.";
      await markFailed(interactionId, "ACCESS_CHECK_FAILED", errMsg);
      return NextResponse.json(
        { message: errMsg, errorCode: "ACCESS_CHECK_FAILED", retryable: true },
        { status: 500 },
      );
    }

    // ── File path validation ──────────────────────────────────────────────
    if (!validateFilePath(filePath)) {
      const errMsg =
        "Invalid audio file path. The path contains unsafe characters.";
      await markFailed(interactionId, "INVALID_PATH", errMsg);
      return NextResponse.json(
        { message: errMsg, errorCode: "INVALID_PATH", retryable: false },
        { status: 400 },
      );
    }

    const fileExt = path.extname(filePath).toLowerCase().replace(".", "");
    const SUPPORTED_AUDIO = [
      "wav",
      "mp3",
      "mp4",
      "m4a",
      "ogg",
      "flac",
      "webm",
      "mpeg",
      "mpga",
      "oga",
    ];
    if (fileExt && !SUPPORTED_AUDIO.includes(fileExt)) {
      const errMsg = `Unsupported audio format ".${fileExt}". Supported: ${SUPPORTED_AUDIO.join(", ")}.`;
      await markFailed(interactionId, "UNSUPPORTED_FORMAT", errMsg);
      return NextResponse.json(
        { message: errMsg, errorCode: "UNSUPPORTED_FORMAT", retryable: false },
        { status: 400 },
      );
    }

    // ── Fetch STT config (API key stays server-side) ──────────────────────
    let cfgResult = null;
    try {
      cfgResult = await executeStoredProcedure(
        "usp_GetTranscriptionConfig",
        {
          appId: appId ? Number(appId) : null,
          ani: ani || null,
          dnis: dnis || null,
          extension: extension || null,
          duration: duration ? Number(duration) : null,
          orgId: orgId ? Number(orgId) : null,
          agentId: body.agentId || null,
          customValue: null,
        },
        outputmsgWithStatusCodeParams,
      );
    } catch (spErr) {
      logWarning(
        "POST /api/transcription-generate",
        "GetTranscriptionConfig SP failed, using direct query fallback",
        { error: spErr.message },
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
        [appId ? Number(appId) : null],
      );

      cfgResult = {
        recordset: dbRes.rows,
        recordsets: [dbRes.rows],
        output: { statuscode: 200, outputmsg: "Success" },
      };
    }

    if (!cfgResult?.recordset?.length) {
      const errMsg =
        "No transcription rule found for this interaction. Create a matching rule in Integration Workspace → Transcription.";
      await markFailed(interactionId, "NO_RULE", errMsg);
      return NextResponse.json(
        { message: errMsg, errorCode: "NO_RULE", retryable: false },
        { status: 404 },
      );
    }

    const cfgRow = cfgResult.recordset[0];

    // Robustly extract provider name or ID from any case-variant of the column
    const sdk =
      cfgRow.Provider_name ||
      cfgRow.provider_name ||
      cfgRow.STTEngine ||
      cfgRow.sttengine ||
      "";
    const apiKey = cfgRow.ApiKey || cfgRow.apikey || "";
    const languageId = cfgRow.LanguageId || cfgRow.languageid || 1;
    const language = cfgRow.Language || cfgRow.language || "English";

    if (!sdk) {
      const errMsg =
        "No STT engine configured in the transcription rule. Edit the rule and select an engine.";
      await markFailed(interactionId, "NO_ENGINE", errMsg);
      return NextResponse.json(
        { message: errMsg, errorCode: "NO_ENGINE", retryable: false },
        { status: 400 },
      );
    }

    const sdkLower = sdk.toLowerCase();
    const isAwsProvider =
      sdkLower.includes("amazon") ||
      sdkLower.includes("aws") ||
      sdkLower.includes("transcribe");
    if (!isAwsProvider && !apiKey) {
      const errMsg = `API key not configured for "${sdk}". Add the key in Integration Workspace → Transcription → Edit Rule.`;
      await markFailed(interactionId, "INVALID_API_KEY", errMsg);
      return NextResponse.json(
        { message: errMsg, errorCode: "INVALID_API_KEY", retryable: false },
        { status: 400 },
      );
    }

    // ── Fetch S3 credentials ──────────────────────────────────────────────
    const creds = await getAWSCredentials();

    // ── Fetch audio ───────────────────────────────────────────────────────
    const sourceType = resolveSourceType(filePath, fileSourceType);
    const audioBuffer = await fetchAudioBuffer(filePath, sourceType, creds);

    // ── Call STT engine ───────────────────────────────────────────────────
    const transcriptionJson = await callSTT(
      sdk,
      apiKey,
      languageId,
      language,
      audioBuffer,
      filePath,
      creds,
    );

    // ── Save JSON to storage ──────────────────────────────────────────────
    const savePath = buildTranscriptionPath(
      filePath,
      sourceType,
      interactionId,
      creds,
    );
    await saveTranscription(savePath, transcriptionJson, creds);

    // ── Update DB with COMPLETED status + file path ───────────────────────
    await updateTranscriptionInDB(interactionId, {
      transcriptionfilepath: savePath,
      transcription_status: "COMPLETED",
      transcription_source_type: sourceType,
    });

    // ── Update rule statistics ────────────────────────────────────────────
    try {
      await executeStoredProcedure("usp_UpdateRuleStats", {});
    } catch (_) {}

    return NextResponse.json(
      { transcription: transcriptionJson, savedPath: savePath },
      { status: 200 },
    );
  } catch (err) {
    logError("POST /api/transcription-generate", err, {
      interactionId: body?.interactionId,
    });
    const { code, message: friendlyMsg, retryable } = classifyError(err);

    logWarning(
      "POST /api/transcription-generate",
      `${code} — interaction ${body?.interactionId}: ${err.message}`,
      {},
    );

    // Write failure to DB so this interaction doesn't retry on every page open
    // Exception: FILE_TOO_LARGE stays retryable (user may change engine to AssemblyAI)
    if (code !== "FILE_TOO_LARGE") {
      await markFailed(body?.interactionId, code, friendlyMsg);
    }

    const httpStatus =
      code === "RULE_MISMATCH"
        ? 403
        : code === "NO_RULE"
          ? 404
          : code === "FILE_TOO_LARGE"
            ? 422
            : code === "PERMANENT_SKIP"
              ? 422
              : code === "RATE_LIMIT"
                ? 429
                : 500;

    return NextResponse.json(
      {
        message: friendlyMsg,
        errorCode: code,
        retryable,
        skip: code === "FILE_TOO_LARGE" || code === "PERMANENT_SKIP",
      },
      { status: httpStatus },
    );
  }
}

/* ── Build save path — includes interactionId to avoid collisions ── */
function buildTranscriptionPath(audioPath, sourceType, interactionId, creds) {
  const ext = path.extname(audioPath);
  const base = interactionId
    ? `${path.basename(audioPath, ext)}_${interactionId}`
    : path.basename(audioPath, ext);
  const folder = creds.TRANSCRIPTION_FOLDER || "Transcriptions";

  if (audioPath.startsWith("s3://")) {
    const withoutPrefix = audioPath.slice(5);
    const slashIdx = withoutPrefix.indexOf("/");
    const bucket = withoutPrefix.slice(0, slashIdx);
    const key = withoutPrefix.slice(slashIdx + 1);
    const keyDir = path.posix.dirname(key);
    const savePath =
      keyDir === "."
        ? `${folder}/${base}.json`
        : `${keyDir}/${folder}/${base}.json`;
    return `s3://${bucket}/${savePath}`;
  }
  if (audioPath.startsWith("gs://")) {
    const withoutPrefix = audioPath.slice(5);
    const slashIdx = withoutPrefix.indexOf("/");
    const bucket = withoutPrefix.slice(0, slashIdx);
    const key = withoutPrefix.slice(slashIdx + 1);
    const keyDir = path.posix.dirname(key);
    const savePath =
      keyDir === "."
        ? `${folder}/${base}.json`
        : `${keyDir}/${folder}/${base}.json`;
    return `gs://${bucket}/${savePath}`;
  }
  const dir = path.dirname(audioPath);
  return path.join(dir, folder, `${base}.json`);
}

/* ── Fetch audio as Buffer ── */
async function fetchAudioBuffer(filePath, sourceType, creds) {
  const isS3 = filePath.startsWith("s3://");
  const isGcs = filePath.startsWith("gs://");
  const isHttp =
    filePath.startsWith("http://") || filePath.startsWith("https://");

  if (isS3 || sourceType === "aws-s3") {
    let bucket = creds.BUCKET;
    let key = filePath;
    if (isS3) {
      const without = filePath.slice(5);
      const idx = without.indexOf("/");
      bucket = without.slice(0, idx);
      key = without.slice(idx + 1);
    }
    const s3Client = new S3Client({
      region: creds.REGION,
      credentials: {
        accessKeyId: creds.AWS_ACCESS_KEY_ID,
        secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
      },
    });
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const obj = await s3Client.send(command);
    const streamToBuffer = async (stream) => {
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    };
    return streamToBuffer(obj.Body);
  }

  if (isGcs || sourceType === "gcp") {
    const storage = new Storage({
      projectId: process.env.GCP_PROJECT_ID,
      keyFilename: process.env.GCP_KEY_FILE,
    });
    let bucketName, objectPath;
    if (isGcs) {
      const without = filePath.slice(5);
      const idx = without.indexOf("/");
      bucketName = without.slice(0, idx);
      objectPath = without.slice(idx + 1);
    } else {
      bucketName = process.env.GCP_BUCKET;
      objectPath = filePath;
    }
    const [contents] = await storage
      .bucket(bucketName)
      .file(objectPath)
      .download();
    return contents;
  }

  if (isHttp) {
    const res = await fetch(filePath);
    if (!res.ok) throw new Error(`Failed to fetch audio: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  // Local / network
  if (!fs.existsSync(filePath))
    throw new Error(`Audio file not found: ${filePath}`);
  return fs.readFileSync(filePath);
}

/* ── Language ID → BCP-47 code ── */
function getLanguageCode(languageId, languageName) {
  // Use language name from DB if available
  const name = (languageName || "").toLowerCase();
  if (name.includes("hindi")) return "hi-IN";
  if (name.includes("english")) return "en-US";
  // Fallback by ID
  const idMap = { 1: "en-US", 2: "hi-IN" };
  return idMap[languageId] || "en-US";
}
async function callSTT(
  sdk,
  apiKey,
  languageId,
  language,
  audioBuffer,
  filePath,
  creds,
) {
  // sdk = Provider_name from tblmst_Transcription_provider
  // DB values: "Google Cloud Speech" | "Amazon Transcribe (AWS)" | "Azure Speech Services"
  //            "Assemblyai" | "OpenAI Whisper v3" | "Google Cloud STT" | "AWS Transcribe"
  const s = (sdk || "").toLowerCase().trim();

  // OpenAI Whisper (ID 5)
  if (s.includes("whisper") || s.includes("openai"))
    return await callOpenAIWhisper(
      apiKey,
      audioBuffer,
      filePath,
      languageId,
      language,
    );

  // AssemblyAI (ID 4)
  if (s.includes("assemblyai") || s.includes("assembly"))
    return await callAssemblyAI(apiKey, audioBuffer, languageId, language);

  // Google Cloud Speech (ID 1) | Google Cloud STT (ID 6)
  if (s.includes("google"))
    return await callGoogleSTT(apiKey, audioBuffer, languageId, language);

  // Amazon Transcribe (AWS) (ID 2) | AWS Transcribe (ID 7)
  if (s.includes("amazon") || s.includes("aws") || s.includes("transcribe"))
    return await callAWSTranscribe(
      audioBuffer,
      filePath,
      languageId,
      language,
      creds,
    );

  // Azure Speech Services (ID 3)
  if (s.includes("azure") || s.includes("microsoft"))
    return await callAzureSTT(apiKey, audioBuffer, languageId, language);

  throw new Error(
    `Unsupported STT provider: "${sdk}". ` +
      `Valid providers: Google Cloud Speech, Amazon Transcribe (AWS), Azure Speech Services, ` +
      `Assemblyai, OpenAI Whisper v3, Google Cloud STT, AWS Transcribe.`,
  );
}

/* ── OpenAI Whisper v3 ── */
async function callOpenAIWhisper(
  apiKey,
  audioBuffer,
  filePath,
  languageId,
  language,
) {
  if (!apiKey)
    throw new Error(
      "OpenAI/Groq API key is required for Whisper transcription.",
    );

  // Whisper hard limit is 25 MB — fall back to AssemblyAI for large files
  const bufSize = audioBuffer?.length ?? audioBuffer?.byteLength ?? 0;
  if (bufSize > 25 * 1024 * 1024) {
    throw new Error(
      `FILE_TOO_LARGE:${(bufSize / 1024 / 1024).toFixed(1)} MB exceeds Whisper 25 MB limit. Configure AssemblyAI rule for this interaction.`,
    );
  }

  // Auto-detect endpoint: gsk_ = Groq, sk- = OpenAI
  const isGroq = apiKey.startsWith("gsk_");
  const endpoint = isGroq
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : "https://api.openai.com/v1/audio/transcriptions";
  // Groq uses whisper-large-v3, OpenAI uses whisper-1
  const modelName = isGroq ? "whisper-large-v3" : "whisper-1";

  const ext = (path.extname(filePath) || ".wav").toLowerCase();
  const mimeMap = {
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".mpeg": "audio/mpeg",
    ".mpga": "audio/mpeg",
    ".oga": "audio/ogg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
  };
  const mimeType = mimeMap[ext] || "audio/wav";
  const fileName = path.basename(filePath) || `audio${ext}`;
  const whisperLang = getWhisperLanguage(languageId, language);

  const audioBlob = new Blob([Buffer.from(audioBuffer)], { type: mimeType });
  const formData = new FormData();
  formData.append("file", audioBlob, fileName);
  formData.append("model", modelName);
  formData.append("response_format", "verbose_json");
  // Groq supports timestamp_granularities too
  formData.append("timestamp_granularities[]", "word");
  if (whisperLang) formData.append("language", whisperLang);

  const transcribeRes = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!transcribeRes.ok) {
    const errText = await transcribeRes.text();
    throw new Error(
      `Whisper transcription failed (${isGroq ? "Groq" : "OpenAI"}): ${transcribeRes.status} — ${errText}`,
    );
  }

  const transcribeData = await transcribeRes.json();

  // Speaker diarization via GPT-4o-mini (best-effort, non-fatal)
  // For Groq keys, use Groq's chat endpoint instead of OpenAI
  let diarizedSegments = null;
  try {
    diarizedSegments = await diarizeWithGPT(
      apiKey,
      transcribeData.text || "",
      isGroq,
    );
  } catch (diarErr) {
    logWarning(
      "POST /api/transcription-generate",
      `Diarization failed: ${diarErr.message}`,
      { interactionId: body?.interactionId },
    );
  }

  return normalizeWhisper(transcribeData, diarizedSegments);
}

/* ── Map language to Whisper ISO-639-1 code ── */
function getWhisperLanguage(languageId, languageName) {
  const name = (languageName || "").toLowerCase();
  if (name.includes("hindi")) return "hi";
  if (name.includes("english")) return "en";
  if (name.includes("spanish")) return "es";
  if (name.includes("french")) return "fr";
  if (name.includes("german")) return "de";
  if (name.includes("portuguese")) return "pt";
  if (name.includes("arabic")) return "ar";
  if (name.includes("chinese")) return "zh";
  if (name.includes("japanese")) return "ja";
  if (name.includes("korean")) return "ko";
  // Fallback by ID
  const idMap = { 1: "en", 2: "hi" };
  return idMap[languageId] || null; // null = let Whisper auto-detect
}

/* ── GPT diarization: label speaker turns in the transcript ── */
async function diarizeWithGPT(apiKey, transcriptText, isGroq = false) {
  if (!transcriptText?.trim()) return null;

  const chatEndpoint = isGroq
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";
  const chatModel = isGroq ? "llama-3.3-70b-versatile" : "gpt-4o-mini";

  const systemPrompt =
    "You are a speaker diarization assistant. Given a verbatim call center transcript, " +
    "identify speaker turns and label each turn as speaker 1 (agent) or speaker 2 (customer). " +
    "IMPORTANT: Copy the text EXACTLY as given — do NOT paraphrase, summarize, or change any words. " +
    'Return ONLY a JSON array with objects: { "speaker": 1 or 2, "text": "exact text" }. ' +
    "No markdown, no explanation, no code fences — raw JSON array only.";

  const gptRes = await fetch(chatEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: chatModel,
      temperature: 0,
      max_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcriptText },
      ],
    }),
  });

  if (!gptRes.ok) {
    const errText = await gptRes.text();
    throw new Error(
      `Diarization failed (${isGroq ? "Groq" : "OpenAI"}): ${gptRes.status} — ${errText}`,
    );
  }

  const gptData = await gptRes.json();
  const raw = gptData.choices?.[0]?.message?.content || "[]";
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

/* ── Normalize Whisper verbose_json → shared Google STT format ── */
function normalizeWhisper(data, diarizedSegments) {
  const words = data.words || [];

  if (diarizedSegments?.length) {
    // If we have word-level timestamps, align them to speaker turns
    if (words.length) {
      return normalizeWhisperWithDiarization(words, diarizedSegments);
    }
    // No word timestamps (Groq whisper-large-v3 doesn't return word timestamps) —
    // build result blocks directly from diarized segments with Whisper segment timing
    return normalizeWhisperDiarizationOnly(
      diarizedSegments,
      data.segments || [],
    );
  }

  // No diarization — emit a single speaker block
  if (!words.length) {
    // Fallback: use segment-level data
    const segments = data.segments || [];
    if (segments.length) {
      return {
        results: segments.map((seg) => ({
          alternatives: [
            {
              transcript: seg.text?.trim() || "",
              words: [],
            },
          ],
        })),
      };
    }
    // Last resort: full text as one block
    return {
      results: [
        {
          alternatives: [
            {
              transcript: data.text?.trim() || "",
              words: [],
            },
          ],
        },
      ],
    };
  }

  // Single speaker, word-level timestamps
  return {
    results: [
      {
        alternatives: [
          {
            transcript: data.text || words.map((w) => w.word).join(" "),
            words: words.map((w) => ({
              word: w.word,
              startTime: `${Number(w.start).toFixed(3)}s`,
              endTime: `${Number(w.end).toFixed(3)}s`,
              speakerTag: 1,
            })),
          },
        ],
      },
    ],
  };
}

/* ── Diarization without word timestamps (Groq path) ── */
function normalizeWhisperDiarizationOnly(diarizedSegments, whisperSegments) {
  // diarizedSegments = [{ speaker: 1|2, text: string }]
  // whisperSegments  = [{ text, start, end }] — used for timing only
  //
  // Strategy: match each diarized turn to the nearest Whisper segment(s) by
  // searching for the first few words of the turn in the concatenated text,
  // then spread timing evenly across individual words.

  const fullText = whisperSegments
    .map((s) => s.text || "")
    .join(" ")
    .toLowerCase();
  let charOffset = 0;

  const results = [];

  for (const seg of diarizedSegments) {
    const text = (seg.text || "").trim();
    if (!text) continue;

    const speakerTag = Number(seg.speaker) || 1;

    // Find approximate position of this turn in the full Whisper text
    const firstWords = text.split(/\s+/).slice(0, 5).join(" ").toLowerCase();
    const matchIdx = fullText.indexOf(firstWords, charOffset);
    charOffset = matchIdx > -1 ? matchIdx + firstWords.length : charOffset;

    // Find which Whisper segment covers charOffset
    let cumLen = 0;
    let startTime = null;
    let endTime = null;
    for (const ws of whisperSegments) {
      const wsLen = (ws.text || "").length + 1;
      if (startTime === null) startTime = Number(ws.start) || 0;
      endTime = Number(ws.end) || 0;
      if (cumLen + wsLen >= charOffset) break;
      cumLen += wsLen;
    }
    startTime = startTime ?? 0;
    endTime = endTime ?? 0;

    // Split the diarized text into individual words and spread timing evenly
    const wordTokens = text.split(/\s+/).filter(Boolean);
    const totalDur = Math.max(endTime - startTime, 0.1);
    const perWord = totalDur / wordTokens.length;

    const words = wordTokens.map((w, i) => ({
      word: w,
      startTime: `${(startTime + i * perWord).toFixed(3)}s`,
      endTime: `${(startTime + (i + 1) * perWord).toFixed(3)}s`,
      speakerTag,
    }));

    results.push({
      alternatives: [
        {
          transcript: text,
          words,
        },
      ],
    });
  }

  return { results };
}

function normalizeWhisperWithDiarization(words, diarizedSegments) {
  // words = Whisper word-level tokens [{ word, start, end }]
  // diarizedSegments = [{ speaker: 1|2, text: string }] from Groq/GPT
  //
  // Problem with index alignment: Groq llama3 paraphrases/condenses the
  // transcript, so word counts don't match → everyone gets speaker 1.
  //
  // Fix: build the full Whisper text, find where each diarized turn starts
  // by character position, then assign speaker tags to Whisper words by
  // their character offset in the full text.

  // Build full Whisper text and track each word's char offset
  const fullText = words.map((w) => w.word).join(" ");
  const fullLower = fullText.toLowerCase();

  // For each Whisper word, record its start char offset in fullText
  let pos = 0;
  const wordOffsets = words.map((w) => {
    const offset = pos;
    pos += w.word.length + 1; // +1 for the space
    return offset;
  });

  // For each diarized segment, find its start char offset in fullLower
  // by searching for the first 4 words of the segment text
  const turnBoundaries = []; // [{ charOffset, speaker }]
  let searchFrom = 0;
  for (const seg of diarizedSegments) {
    const segText = (seg.text || "").trim().toLowerCase();
    if (!segText) continue;
    const probe = segText.split(/\s+/).slice(0, 4).join(" ");
    const idx = fullLower.indexOf(probe, searchFrom);
    if (idx !== -1) {
      turnBoundaries.push({
        charOffset: idx,
        speaker: Number(seg.speaker) || 1,
      });
      searchFrom = idx + probe.length;
    } else {
      // Probe not found (paraphrase) — use searchFrom as best guess
      turnBoundaries.push({
        charOffset: searchFrom,
        speaker: Number(seg.speaker) || 1,
      });
    }
  }

  // Assign each Whisper word to a speaker based on which turn boundary it falls in
  const getSpeaker = (charOffset) => {
    let speaker = turnBoundaries[0]?.speaker ?? 1;
    for (const b of turnBoundaries) {
      if (charOffset >= b.charOffset) speaker = b.speaker;
      else break;
    }
    return speaker;
  };

  // Build aligned word list with real Whisper timestamps
  const aligned = words.map((w, i) => ({
    word: w.word,
    startTime: `${Number(w.start).toFixed(3)}s`,
    endTime: `${Number(w.end).toFixed(3)}s`,
    speakerTag: getSpeaker(wordOffsets[i]),
  }));

  // Group consecutive same-speaker words into result blocks
  const results = [];
  let currentSpeaker = null;
  let currentWords = [];

  for (const w of aligned) {
    if (w.speakerTag !== currentSpeaker) {
      if (currentWords.length) {
        results.push({
          alternatives: [
            {
              transcript: currentWords.map((x) => x.word).join(" "),
              words: currentWords,
            },
          ],
        });
      }
      currentSpeaker = w.speakerTag;
      currentWords = [];
    }
    currentWords.push(w);
  }
  if (currentWords.length) {
    results.push({
      alternatives: [
        {
          transcript: currentWords.map((x) => x.word).join(" "),
          words: currentWords,
        },
      ],
    });
  }

  return { results };
}

/* ── AssemblyAI ── */
async function callAssemblyAI(apiKey, audioBuffer, languageId, language) {
  const langCode = getLanguageCode(languageId, language);

  // 1. Upload audio
  const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/octet-stream",
    },
    body: audioBuffer,
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(
      `AssemblyAI upload failed: ${uploadRes.status} — ${errText}`,
    );
  }
  const { upload_url } = await uploadRes.json();
  if (!upload_url) throw new Error("AssemblyAI upload returned no URL");

  // 2. Submit — try speech_models array (v3), fall back to plain v2 (no model field)
  const baseBody = {
    audio_url: upload_url,
    speaker_labels: true,
    speakers_expected: 2,
  };
  if (langCode !== "en-US") baseBody.language_code = langCode;

  // Try with speech_models array first (required by some account tiers)
  let submitRes = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({ ...baseBody, speech_models: ["universal-2"] }),
  });

  // If rejected, retry without any model field (free/legacy accounts)
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    if (errText.includes("speech_model") || errText.includes("universal")) {
      submitRes = await fetch("https://api.assemblyai.com/v2/transcript", {
        method: "POST",
        headers: { authorization: apiKey, "content-type": "application/json" },
        body: JSON.stringify(baseBody),
      });
      if (!submitRes.ok) {
        const errBody = await submitRes.text();
        throw new Error(
          `AssemblyAI submit failed: ${submitRes.status} — ${errBody}`,
        );
      }
    } else {
      throw new Error(
        `AssemblyAI submit failed: ${submitRes.status} — ${errText}`,
      );
    }
  }

  const { id: transcriptId, error: submitError } = await submitRes.json();
  if (submitError) throw new Error(`AssemblyAI submit error: ${submitError}`);
  if (!transcriptId) throw new Error("AssemblyAI returned no transcript ID");

  // 3. Poll until complete — initial 5s wait, then 3s intervals, max 5 min
  const pollUrl = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;
  await new Promise((r) => setTimeout(r, 5000)); // initial wait
  for (let i = 0; i < 90; i++) {
    const pollRes = await fetch(pollUrl, {
      headers: { authorization: apiKey },
    });
    if (!pollRes.ok) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const data = await pollRes.json();
    if (data.status === "completed") return normalizeAssemblyAI(data);
    if (data.status === "error")
      throw new Error(`AssemblyAI error: ${data.error}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("AssemblyAI timed out after 5 minutes");
}

function normalizeAssemblyAI(data) {
  // Normalize to Google STT format (results[].alternatives[].words[])
  const speakerMap = {};
  let speakerIdx = 1;
  const results = [];
  let currentSpeaker = null;
  let currentWords = [];

  for (const word of data.words || []) {
    const spk = word.speaker || "A";
    if (!speakerMap[spk]) speakerMap[spk] = speakerIdx++;
    const speakerTag = speakerMap[spk];

    if (currentSpeaker !== speakerTag) {
      if (currentWords.length) {
        results.push({
          alternatives: [
            {
              transcript: currentWords.map((w) => w.text).join(" "),
              words: currentWords,
            },
          ],
        });
      }
      currentSpeaker = speakerTag;
      currentWords = [];
    }
    currentWords.push({
      word: word.text,
      startTime: `${(word.start / 1000).toFixed(3)}s`,
      endTime: `${(word.end / 1000).toFixed(3)}s`,
      speakerTag,
    });
  }
  if (currentWords.length) {
    results.push({
      alternatives: [
        {
          transcript: currentWords.map((w) => w.text).join(" "),
          words: currentWords,
        },
      ],
    });
  }
  return { results };
}

/* ── Google Cloud STT ── */
async function callGoogleSTT(apiKey, audioBuffer, languageId, language) {
  const langCode = getLanguageCode(languageId, language);
  const audioB64 = Buffer.from(audioBuffer).toString("base64");

  // Use ENCODING_UNSPECIFIED so Google auto-detects WAV/MP3/etc.
  // Do NOT hardcode encoding or sampleRateHertz — Google reads the file header
  const res = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: {
          languageCode: langCode,
          enableSpeakerDiarization: true,
          diarizationSpeakerCount: 2,
          enableWordTimeOffsets: true,
          // encoding omitted → ENCODING_UNSPECIFIED → Google auto-detects from file header
          // sampleRateHertz omitted → auto-detected
          model: "phone_call", // optimised for telephony / call center audio
        },
        audio: { content: audioB64 },
      }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google STT failed: ${res.status} — ${err}`);
  }
  return await res.json();
}

/* ── AWS Transcribe (uses env credentials — no API key needed) ── */
async function callAWSTranscribe(
  audioBuffer,
  filePath,
  languageId,
  language,
  creds,
) {
  const langCode = getLanguageCode(languageId, language);
  const jobName = `qm-${Date.now()}`;
  const bucket = creds.BUCKET;
  const rawExt = path.extname(filePath).toLowerCase().replace(".", "") || "wav";
  // AWS Transcribe supported formats
  const fmtMap = {
    mp3: "mp3",
    mp4: "mp4",
    wav: "wav",
    flac: "flac",
    ogg: "ogg",
    amr: "amr",
    webm: "webm",
    m4a: "mp4",
  };
  const mediaFmt = fmtMap[rawExt] || "wav";
  const key = `temp-transcribe/${jobName}.${mediaFmt}`;

  const awsConfig = {
    region: creds.REGION,
    credentials: {
      accessKeyId: creds.AWS_ACCESS_KEY_ID,
      secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
    },
  };

  const s3Client = new S3Client(awsConfig);
  const transcribeClient = new TranscribeClient(awsConfig);

  try {
    // 1. Upload temp file to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: audioBuffer,
      }),
    );

    // 2. Start Job
    await transcribeClient.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: langCode,
        MediaFormat: mediaFmt,
        Media: { MediaFileUri: `s3://${bucket}/${key}` },
        Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 },
      }),
    );

    // 3. Poll
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { TranscriptionJob: job } = await transcribeClient.send(
        new GetTranscriptionJobCommand({
          TranscriptionJobName: jobName,
        }),
      );

      if (job.TranscriptionJobStatus === "COMPLETED") {
        const resultRes = await fetch(job.Transcript.TranscriptFileUri);
        const result = await resultRes.json();
        // Cleanup temp file
        await s3Client
          .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
          .catch(() => {});
        return normalizeAWSTranscribe(result);
      }
      if (job.TranscriptionJobStatus === "FAILED") {
        throw new Error(`AWS Transcribe failed: ${job.FailureReason}`);
      }
    }
    throw new Error("AWS Transcribe timed out after 3 minutes");
  } finally {
    // Always cleanup temp file even on error
    await s3Client
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
      .catch(() => {});
  }
}

function normalizeAWSTranscribe(data) {
  const items = data?.results?.items || [];
  const results = [];
  let currentSpk = null;
  let currentWords = [];

  for (const item of items) {
    if (item.type !== "pronunciation") continue;
    const spk = item.speaker_label || "spk_0";
    const tag = spk === "spk_0" ? 1 : 2;
    if (currentSpk !== tag) {
      if (currentWords.length)
        results.push({
          alternatives: [
            {
              transcript: currentWords.map((w) => w.word).join(" "),
              words: currentWords,
            },
          ],
        });
      currentSpk = tag;
      currentWords = [];
    }
    currentWords.push({
      word: item.alternatives?.[0]?.content || "",
      startTime: `${item.start_time}s`,
      endTime: `${item.end_time}s`,
      speakerTag: tag,
    });
  }
  if (currentWords.length)
    results.push({
      alternatives: [
        {
          transcript: currentWords.map((w) => w.word).join(" "),
          words: currentWords,
        },
      ],
    });
  return { results };
}

/* ── Azure Speech ── */
async function callAzureSTT(apiKey, audioBuffer, languageId, language) {
  const langCode = getLanguageCode(languageId, language);
  const region = process.env.AZURE_REGION;
  if (!region) throw new Error("AZURE_REGION not set in .env");

  const res = await fetch(
    `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${langCode}&format=detailed`,
    {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "audio/wav",
      },
      body: audioBuffer,
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Azure STT failed: ${res.status} — ${err}`);
  }
  const data = await res.json();
  return {
    results: [
      {
        alternatives: [
          {
            transcript: data.DisplayText || "",
            words: (data.NBest?.[0]?.Words || []).map((w) => ({
              word: w.Word,
              startTime: `${(w.Offset / 1e7).toFixed(3)}s`,
              endTime: `${((w.Offset + w.Duration) / 1e7).toFixed(3)}s`,
              speakerTag: 1,
            })),
          },
        ],
      },
    ],
  };
}

/* ── Save transcription to storage ── */
async function saveTranscription(savePath, transcriptionJson, creds) {
  const jsonStr = JSON.stringify(transcriptionJson, null, 2);
  const buf = Buffer.from(jsonStr, "utf-8");

  const isS3 = savePath.startsWith("s3://");
  const isGcs = savePath.startsWith("gs://");

  if (isS3) {
    const without = savePath.slice(5);
    const idx = without.indexOf("/");
    const bucket = without.slice(0, idx);
    const key = without.slice(idx + 1);
    const s3Client = new S3Client({
      region: creds.REGION,
      credentials: {
        accessKeyId: creds.AWS_ACCESS_KEY_ID,
        secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
      },
    });
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buf,
        ContentType: "application/json",
      }),
    );
    return;
  }

  if (isGcs) {
    const without = savePath.slice(5);
    const idx = without.indexOf("/");
    const bucketName = without.slice(0, idx);
    const objectPath = without.slice(idx + 1);
    const storage = new Storage({
      projectId: process.env.GCP_PROJECT_ID,
      keyFilename: process.env.GCP_KEY_FILE,
    });
    await storage
      .bucket(bucketName)
      .file(objectPath)
      .save(buf, { contentType: "application/json" });
    return;
  }

  // Local / network
  const dir = path.dirname(savePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(savePath, jsonStr, "utf-8");
}
