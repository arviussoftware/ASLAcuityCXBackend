import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 },
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const channel = body.sendFileChannel || "";

    const params = {
      appid: parseInt(body.appid) || 0,
      instance: body.instance || "",
      orgId: body.orgId || "",
      tokenUrl: body.tokenUrl || "",
      clientId: body.clientId || "",
      clientSecret: body.clientSecret || "",
      redirectUri: body.redirectUri || "",
      baseUrl: body.baseUrl || "",
      token: body.token || "",

      tokenExpiresInSeconds: parseInt(body.tokenExpiresInSeconds) || 0,
      refreshToken: body.refreshToken || "",
      refreshTokenExpiresInSec: parseInt(body.refreshTokenExpiresInSec) || 0,

      timezone: body.timezone || "",
      destDirectory: body.destDirectory || "",
      fileFormat: body.fileFormat || "",
      folderStructure: body.folderStructure || "",

      startTime: body.startTime || null,
      expiryTime: body.expiryTime || null,

      frequencyInMinutes: parseInt(body.frequencyInMinutes) || 0,

      UpdatedBy: parseInt(body.Modifieddby) || 0,
      //Organization: parseInt(body.Organization) || 0,
      Transcription: body.transcription || 0,
      transcriptionEngine: body.transcriptionEngine || null,
      // ── Send File channel ────────────────────────────────────
      sendFileChannel: channel,

      // ── S3 fields (null if channel is not S3) ───────────────
      bucketRegion: channel === "S3" ? body.bucketRegion || "" : null,
      bucketName: channel === "S3" ? body.bucketName || "" : null,
      accessKey: channel === "S3" ? body.accessKey || "" : null,
      secretKey: channel === "S3" ? body.secretKey || "" : null,
      storageClass: channel === "S3" ? body.storageClass || "" : null,

      // ── SFTP fields (null if channel is not SFTP) ───────────
      sftpServerName: channel === "SFTP" ? body.sftpServerName || "" : null,
      sftpBaseFolder: channel === "SFTP" ? body.sftpBaseFolder || "" : null,
      sftpUserId: channel === "SFTP" ? body.sftpUserId || "" : null,
      sftpPassword: channel === "SFTP" ? body.sftpPassword || "" : null,
      sftpSshKey: channel === "SFTP" ? body.sftpSshKey || "" : null,

      // ── GCP fields (null if channel is not GCP) ─────────────
      gcpBucket: channel === "GCP" ? body.gcpBucket || "" : null,
      gcpProjectId: channel === "GCP" ? body.gcpProjectId || "" : null,
      gcpServiceKey: channel === "GCP" ? body.gcpServiceKey || "" : null,

      // ── AZURE fields (null if channel is not AZURE) ─────────────
      azureAccount: channel === "AZURE" ? body.azureAccount || "" : null,
      azureContainer: channel === "AZURE" ? body.azureContainer || "" : null,
      azureConnection: channel === "AZURE" ? body.azureConnection || "" : null,
    };

    const result = await executeStoredProcedure(
      "usp_UpdateAppSettings",
      params,
    );

    return NextResponse.json({
      success: true,
      message: "Configuration updated successfully",
      data: result.recordset || [],
    });
  } catch (error) {
    console.error("Error updating app settings:", error);

    return NextResponse.json(
      {
        success: false,
        message: error.message,
      },
      { status: 500 },
    );
  }
}
