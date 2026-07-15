import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeFilters = (value) =>
  parseJsonArray(value).map((item, index) => ({
    id: item?.id || `filter-${index}-${Date.now()}`,
    filterName: item?.filterName || "",
    expression: item?.expression || "",
    value: item?.value || "",
    customDataId: item?.customDataId || "",
    csvLabel: item?.csvLabel || "",
    csvValues: item?.csvValues || "",
    csvFileName:
      String(item?.expression || "").toUpperCase() === "RANGE" && item?.csvValues
        ? "Saved Range"
        : "",
  }));

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");

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

    const { searchParams } = new URL(request.url);
    const processId = searchParams.get("processId");

    const result = await executeStoredProcedure("usp_GetVerintConfigurations", {
      currentUserId: Number(loggedInUserId || 1),
      ProcessID: processId ? Number(processId) : null,
    });

    const normalizedConfigurations = (result.recordset || []).map((item) => ({
      ...item,
      instanceName: item.instanceName || "",
      ruleName: item.ruleName || item.processName || "",
      // Destination config (support multiple casings / aliases from SP)
      sendFile: item.sendFile || item.SendFile || item.Send_File || item.send_file || "",
      storageClass: item.storageClass || item.StorageClass || item.storage_class || item.storageClassName || "",
      bucketRegion: item.bucketRegion || item.BucketRegion || item.bucket_region || "",
      bucketName: item.bucketName || item.BucketName || item.bucket_name || "",
      accessKey: item.accessKey || item.AccessKey || item.access_key || "",
      // NOTE: SecretKey might intentionally be omitted by the SP for security.
      secretKey: item.secretKey || item.SecretKey || item.secret_key || "",
      gcpBucket: item.gcpBucket || item.GcpBucket || item.gcp_bucket || "",
      gcpProjectId: item.gcpProjectId || item.GcpProjectId || item.gcp_project_id || "",
      gcpServiceKey: item.gcpServiceKey || item.GcpServiceKey || item.gcp_service_key || "",
      azureAccount: item.azureAccount || item.AzureAccount || item.azure_account || "",
      azureContainer: item.azureContainer || item.AzureContainer || item.azure_container || "",
      azureConnection: item.azureConnection || item.AzureConnection || item.azure_connection || "",
      fileNaming: parseJsonArray(item.fileNaming).map((entry) => entry?.name || entry).filter(Boolean),
      metadataField: parseJsonArray(item.metadataField).map((entry) => entry?.name || entry).filter(Boolean),
      filters: normalizeFilters(item.filters),
    }));

    return NextResponse.json({
      success: true,
      message: "Verint configurations fetched successfully.",
      data: normalizedConfigurations,
    });
  } catch (error) {
    console.error("Error fetching Verint configurations:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to fetch Verint configurations." },
      { status: 500 },
    );
  }
}




