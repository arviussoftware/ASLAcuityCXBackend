import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
const verintSaveOutputParams = [
  { name: "outputmsg" },
  { name: "statuscode" },
  { name: "appid" },
  { name: "rules_id" },
];

const parseRangeCsvPayload = (csvText) => {
  const text = String(csvText || "").trim();
  if (!text) return { csvLabel: "", csvValues: "" };

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return { csvLabel: "", csvValues: "" };

  const parsedValues = [];
  let csvLabel = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const columns = line.split(",").map((column) => column.trim().replace(/^"|"$/g, ""));
    const firstColumn = columns[0];
    const secondColumn = columns[1];

    const isHeaderRow =
      index === 0 &&
      ["name", "filter name"].includes(String(firstColumn || "").toLowerCase()) &&
      ["extension", "value", "values"].includes(String(secondColumn || "").toLowerCase());

    if (isHeaderRow) continue;

    if (!csvLabel && firstColumn) {
      csvLabel = firstColumn;
    }

    if (!secondColumn) continue;

    parsedValues.push(secondColumn);
  }

  return {
    csvLabel,
    csvValues: parsedValues.join(","),
  };
};

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
      platformId,
    } = body || {};

    const resolvedUserId = Number(currentUserId || loggedInUserId || 1);

    if (!ruleName || !startDate || !hostName || !vcApiUserId) {
      return NextResponse.json(
        {
          success: false,
          message: "ruleName, startDate, hostName and vcApiUserId are required.",
        },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure(
      "usp_SaveVerintConfiguration",
      {
        currentUserId: resolvedUserId,
        PlatformId: platformId || 13,
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
        FiltersJson: JSON.stringify(
          (filters || []).map((item) => {
            if (String(item?.expression || "").toLowerCase() !== "range") {
              return {
                ...item,
                csvLabel: "",
                csvValues: item?.csvValues || "",
              };
            }

            const parsedRange = parseRangeCsvPayload(item?.csvValues);

            return {
              ...item,
              csvLabel: parsedRange.csvLabel,
              csvValues: parsedRange.csvValues,
            };
          }),
        ),
      },
      verintSaveOutputParams,
       
    );

    const statusCode = Number(result.output?.statuscode) || 500;
    const createdAppId = result.output?.appid;
    const createdRuleId = result.output?.rules_id;
    const isSuccess =
      statusCode >= 200 &&
      statusCode < 300 &&
      createdAppId !== undefined &&
      createdAppId !== null &&
      createdRuleId !== undefined &&
      createdRuleId !== null;

    return NextResponse.json(
      {
        success: isSuccess,
        message: result.output?.outputmsg || (isSuccess ? "Configuration saved." : "Configuration was not saved."),
        data: {
          output: result.output,
        },
      },
      { status: isSuccess ? statusCode : 500 },
    );
  } catch (error) {
    console.error("Error while saving Verint configuration:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to save configuration." },
      { status: 500 },
    );
  }
}
