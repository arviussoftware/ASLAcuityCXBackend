// app/api/interactions/downloadSelected/file/route.js
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { getJob } from "@/lib/downloadJobs";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(req) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    const jobId = new URL(req.url).searchParams.get("jobId");
    if (!jobId) {
      return new Response("jobId is required", { status: 400 });
    }

    const job = getJob(jobId);
    if (!job) {
      return new Response("Job not found", { status: 404 });
    }

    if (!job.filePath) {
      return new Response("File not ready yet.", { status: 409 });
    }

    if (!fs.existsSync(job.filePath)) {
      return new Response("File no longer available on the server.", {
        status: 410,
      });
    }

    const stat = fs.statSync(job.filePath);
    const nodeStream = fs.createReadStream(job.filePath);
    const webStream = Readable.toWeb(nodeStream);

    return new Response(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${path.basename(job.filePath)}"`,
      },
    });
  } catch (error) {
    console.error("[downloadSelected/file] error:", error);
    await logError("GET /api/interactions/downloadSelected/file", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
