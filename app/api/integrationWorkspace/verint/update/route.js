import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

// IMPORTANT:
// This route expects a SQL stored procedure named `usp_UpdateVerintConfiguration`
// that performs UPDATE logic using `appid` and/or `rules_id`.

const verintUpdateOutputParams = [
  { name: "outputmsg" },
  { name: "statuscode" },
];

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
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

    const loggedInUserId = request.headers.get("loggedInUserId");
    const body = await request.json();

    const {
      appid,
      rules_id,
      instanceName,
      ruleName,
      startDate,
      timeZone,
      scheduleType,
      hourlyInterval,
      hostName,
      vcApiUserId,
      vcDomain,
      apiPassword,
      apiKeyId,
      apiKeyName,
      expiryDateTime,
      metadataType,
      metadataFormat,
      fileNaming = [],
      metadataFields = [],
      exportFormat,
      audioType,
      folderStructure,
      folderPath,
      percentage,
      sendFile,
      storageClass,
      bucketRegion,
      bucketName,
      accessKey,
      secretKey,
      gcpBucket,
      gcpProjectId,
      gcpServiceKey,
      azureAccount,
      azureContainer,
      azureConnection,
      sftpServerName,
      sftpBaseFolder,
      sftpUserId,
      sftpPassword,
      sftpSshKey,
      filters = [],
      processId,
      processName,
      currentUserId,
    } = body || {};

    const resolvedUserId = Number(currentUserId || loggedInUserId || 1);

    if (!appid && !rules_id) {
      return NextResponse.json(
        { success: false, message: "appid or rules_id is required for update." },
        { status: 400 },
      );
    }

    if (!ruleName || !startDate || !hostName || !vcApiUserId) {
      return NextResponse.json(
        { success: false, message: "ruleName, startDate, hostName and vcApiUserId are required." },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure(
      "usp_UpdateVerintConfiguration",
      {
        currentUserId: resolvedUserId,
        appid: appid ?? null,
        rules_id: rules_id ?? null,
        InstanceName: instanceName || null,
        RuleName: ruleName,
        StartDate: new Date(startDate),
        TimeZone: timeZone || null,
        ScheduleType: scheduleType || "DAILY",
        HourlyInterval:
          scheduleType === "HOURLY"
            ? Number(hourlyInterval || 1)
            : null,
        HostName: hostName,
        VcApiUserId: vcApiUserId,
        VcDomain: vcDomain || null,
        ApiPassword: apiPassword || null,
        ApiKeyId: apiKeyId || null,
        ApiKeyName: apiKeyName || null,
        ExpiryDateTime: expiryDateTime ? new Date(expiryDateTime) : null,
        MetadataType: metadataType || null,
        MetadataFormat: metadataFormat || null,
        FileNamingJson: JSON.stringify(fileNaming || []),
        MetadataFieldsJson: JSON.stringify(metadataFields || []),
        ExportFormat: exportFormat || null,
        AudioType: audioType || null,
        FolderStructure: folderStructure || null,
        FolderPath: folderPath || null,
        Percentage: percentage ?? null,
        SendFile: sendFile || null,
        StorageClass: storageClass || null,
        BucketRegion: bucketRegion || null,
        BucketName: bucketName || null,
        AccessKey: accessKey || null,
        SecretKey: secretKey || null,
        GcpBucket: gcpBucket || null,
        GcpProjectId: gcpProjectId || null,
        GcpServiceKey: gcpServiceKey || null,
        AzureAccount: azureAccount || null,
        AzureContainer: azureContainer || null,
        AzureConnection: azureConnection || null,
        ProcessID: processId ?? null,
        ProcessName: processName || null,
        SftpServerName: sftpServerName || null,
        SftpBaseFolder: sftpBaseFolder || null,
        SftpUserId: sftpUserId || null,
        SftpPassword: sftpPassword || null,
        SftpSshKey: sftpSshKey || null,
        FiltersJson: JSON.stringify(filters || []),
      },
      verintUpdateOutputParams,
    );

    const statusCode = Number(result.output?.statuscode) || 500;
    const isSuccess = statusCode >= 200 && statusCode < 300;

    return NextResponse.json(
      {
        success: isSuccess,
        message: result.output?.outputmsg || (isSuccess ? "Configuration updated." : "Configuration was not updated."),
        data: {
          output: result.output,
        },
      },
      { status: isSuccess ? statusCode : 500 },
    );
  } catch (error) {
    console.error("Error while updating Verint configuration:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to update configuration." },
      { status: 500 },
    );
  }
}

