// lib/downloadJobs.js
import fs from "fs";
import os from "os";
import path from "path";

const BULK_DOWNLOAD_STAGING_DIR = path.join(
  os.tmpdir(),
  "acuitycx-bulk-downloads",
);
const JOBS_DIR = path.join(BULK_DOWNLOAD_STAGING_DIR, ".jobs");
const JOB_TTL_MS = 24 * 60 * 60 * 1000; // matches the 24h promise in the export email

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
  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`; // unique per write, not just per-pid
  fs.writeFileSync(tmpPath, JSON.stringify(job), "utf8");

  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmpPath, finalPath);
      return;
    } catch (err) {
      const transient =
        err.code === "EPERM" || err.code === "EBUSY" || err.code === "ENOENT";
      if (!transient || attempt === MAX_ATTEMPTS) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
        throw err;
      }
      // brief blocking backoff — these are already sync calls in a sync codepath
      const waitUntil = Date.now() + attempt * 20;
      while (Date.now() < waitUntil) {}
    }
  }
}

export function createJob(jobId, meta) {
  const job = {
    id: jobId,
    status: "running",
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
          // Remove the staged zip too — this is what the export email
          // promises ("deleted after 24 hours"), and previously nothing
          // actually did it, so exported zips accumulated forever.
          if (job.filePath) {
            try {
              fs.unlinkSync(job.filePath);
            } catch {
              // Already gone or never existed — fine either way.
            }
          }
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
