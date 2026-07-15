// lib/downloadJobs.js
import fs from "fs";
import path from "path";

// Jobs are persisted to disk (not kept in an in-memory Map) because this
// app may run with multiple worker processes — an in-memory Map only lives
// inside the one process that created it, so other workers polling status
// or handling cancel requests would never see it (this was causing 404s).
const JOBS_DIR = path.join(
  process.env.BULK_DOWNLOAD_PATH || "C:\\interaction_download",
  ".jobs",
);
const JOB_TTL_MS = 60 * 60 * 1000; // drop finished job files after 1hr

function ensureJobsDir() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function jobFilePath(jobId) {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

function readJobFile(jobId) {
  try {
    const raw = fs.readFileSync(jobFilePath(jobId), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJobFile(job) {
  ensureJobsDir();
  const finalPath = jobFilePath(job.id);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(job), "utf8");
  fs.renameSync(tmpPath, finalPath); // rename is effectively atomic on the same volume
}

export function createJob(jobId, meta) {
  const job = {
    id: jobId,
    status: "running", // running | completed | failed | cancelled
    processed: 0,
    failed: 0,
    total: meta.total,
    archiveFileName: meta.archiveFileName,
    dateRangeLabel: meta.dateRangeLabel,
    downloadType: meta.downloadType,
    error: null,
    cancelRequested: false,
    startedAt: Date.now(),
    finishedAt: null,
  };
  writeJobFile(job);
  return job;
}

export function getJob(jobId) {
  return readJobFile(jobId);
}

export function updateJob(jobId, patch) {
  const job = readJobFile(jobId);
  if (!job) return null;
  const updated = { ...job, ...patch };
  writeJobFile(updated);
  return updated;
}

export function completeJob(jobId, patch = {}) {
  return updateJob(jobId, {
    status: "completed",
    finishedAt: Date.now(),
    ...patch,
  });
}

export function failJob(jobId, error) {
  return updateJob(jobId, {
    status: "failed",
    error: String(error?.message || error),
    finishedAt: Date.now(),
  });
}

export function cancelJob(jobId, patch = {}) {
  return updateJob(jobId, {
    status: "cancelled",
    finishedAt: Date.now(),
    ...patch,
  });
}

export function requestCancel(jobId) {
  return updateJob(jobId, { cancelRequested: true });
}

export function isCancelRequested(jobId) {
  const job = readJobFile(jobId);
  return Boolean(job?.cancelRequested);
}

function cleanupOldJobFiles() {
  try {
    ensureJobsDir();
    const now = Date.now();
    for (const file of fs.readdirSync(JOBS_DIR)) {
      if (!file.endsWith(".json")) continue;
      const fullPath = path.join(JOBS_DIR, file);
      try {
        const job = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // Corrupt or half-written file — ignore, next cleanup pass will retry.
      }
    }
  } catch (err) {
    console.error("Job cleanup failed:", err);
  }
}

if (!global.__downloadJobCleanupTimer) {
  global.__downloadJobCleanupTimer = setInterval(
    cleanupOldJobFiles,
    10 * 60 * 1000,
  );
  global.__downloadJobCleanupTimer.unref?.();
}
