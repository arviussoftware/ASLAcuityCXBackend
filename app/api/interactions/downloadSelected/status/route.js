import { NextResponse } from "next/server";
import { getJob } from "@/lib/downloadJobs";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ message: "jobId is required" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ message: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
