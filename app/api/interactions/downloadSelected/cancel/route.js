import { NextResponse } from "next/server";
import { getJob, requestCancel } from "@/lib/downloadJobs";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const jobId = body.jobId;

  if (!jobId) {
    return NextResponse.json({ message: "jobId is required" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ message: "Job not found" }, { status: 404 });
  }

  if (job.status !== "running") {
    // Already finished, failed, or cancelled — nothing to do.
    return NextResponse.json({ job });
  }

  requestCancel(jobId);
  return NextResponse.json({
    message: "Cancellation requested",
    job: getJob(jobId),
  });
}
