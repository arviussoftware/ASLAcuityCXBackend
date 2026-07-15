import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
const amazonConnectSaveOutputParams = [
  { name: "outputmsg" },
  { name: "statuscode" },
  { name: "appid" },
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

    const toDateOrNull = (value) => {
      if (value === null || value === undefined || value === "") return null;
      if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
      const d = new Date(value);
      return Number.isFinite(d.getTime()) ? d : null;
    };

    const {
      platformid,
      OrgId,
      Instance_Name,
      Intance_Id,
      Region_Endpoint,
      BucketName,
      AccessKey,
      SecretKey,
      TimeZone,
      Instance_Type,
      Start_Time,
      End_Time,
      Frequency,
      FileFormat,
      DestDirectory,
      FolderStructure,
      SendFileChannel,
      Transcription,
      GcpBucket,
      GcpProjectId,
      GcpServiceKey,
      AzureAccount,
      AzureContainer,
      AzureConnection,
      HourlyInterval,
      OAuthTokenUrl,
      OAuthBaseUrl,
      OAuthRedirectUri,
      OAuthClientId,
      OAuthClientSecret,
      BucketRegion,
      StorageClass,
      SftpServerName,
      SftpBaseFolder,
      SftpUserId,
      SftpPassword,
      SftpSshKey,
      ServiceName,
      AWSRegion,
      Token,
      TokenType,
      TokenExpiresInSeconds,
      RefreshToken,
      RefreshTokenExpiresInSeconds,
      createdBy,
      currentUserId,
    } = body || {};

    const resolvedUserId = Number(currentUserId || loggedInUserId || 1);
    const resolvedPlatformId = Number(platformid ?? 4) || 4;

    if (!Instance_Name || !Intance_Id || !Region_Endpoint) {
      return NextResponse.json(
        {
          success: false,
          message: "Instance_Name, Intance_Id and Region_Endpoint are required.",
        },
        { status: 400 },
      );
    }

    const scheduleType = String(Frequency || "").toUpperCase();
    const intervalInMinute =
      scheduleType === "HOURLY"
        ? Math.max(1, Number(HourlyInterval || 1)) * 60
        : scheduleType
          ? 1440
          : null;

    const normalizedTranscription = (() => {
      const v = Transcription;
      if (v === 1 || v === "1" || v === true) return 1;
      const t = String(v ?? "").trim().toUpperCase();
      if (t === "YES" || t === "Y" || t === "TRUE") return 1;
      return 0;
    })();

    // Preferred (new) parameters for tblmst_Appsettings
    const newParams = {
      currentUserId: resolvedUserId,
      PlatformId: resolvedPlatformId,
      OrganizationId: OrgId ?? null,
      CreatedBy: createdBy || null,

      InstanceName: Instance_Name || null,
      AWSConnectInstanceId: Intance_Id || null,
      AwsConnectRegion: AWSRegion || null,
      SourceAccessKeyAmazonConnect: OAuthClientId || null,
      SourceSecretKeyAmazonConnect: OAuthClientSecret || null,
      instancetype: Instance_Type || null,
      sourceregionendpoint: Region_Endpoint || null,
      sourcebucketname: BucketName || null,

      Tokenurl: OAuthTokenUrl || null,
      clientId: null,
      ClientSecret: null,
      Redirect_URI: OAuthRedirectUri || null,
      BaseUrl: OAuthBaseUrl || null,

      timezone: TimeZone || null,
      Destdirectory: DestDirectory || null,
      FileFormat: FileFormat || null,
      FolderStrtucture: FolderStructure || null,
      intervalInMinute,
      Start_Time: toDateOrNull(Start_Time),
      End_Time: toDateOrNull(End_Time),

      Transcription: normalizedTranscription,
      SendFileChannel: SendFileChannel || null,
      S3BucketRegion: BucketRegion || null,
      S3BucketName: BucketName || null,
      S3AccessKey: AccessKey || null,
      S3SecretKey: SecretKey || null,
      S3StorageClass: StorageClass || null,
      SftpServerName: SftpServerName || null,
      SftpBaseFolder: SftpBaseFolder || null,
      SftpUserId: SftpUserId || null,
      SftpPassword: SftpPassword || null,
      SftpSshKey: SftpSshKey || null,
      ServiceName: ServiceName || null,

      // Extended channels (if supported by SP/schema)
      gcpBucket: String(SendFileChannel || "").toUpperCase() === "GCP" ? (GcpBucket || null) : null,
      gcpProjectId: String(SendFileChannel || "").toUpperCase() === "GCP" ? (GcpProjectId || null) : null,
      gcpServiceKey: String(SendFileChannel || "").toUpperCase() === "GCP" ? (GcpServiceKey || null) : null,
      azureAccount: String(SendFileChannel || "").toUpperCase() === "AZURE" ? (AzureAccount || null) : null,
      azureContainer: String(SendFileChannel || "").toUpperCase() === "AZURE" ? (AzureContainer || null) : null,
      azureConnection: String(SendFileChannel || "").toUpperCase() === "AZURE" ? (AzureConnection || null) : null,

      token: Token || null,
      token_type: TokenType || null,
      TokenExpiresInSeconds: TokenExpiresInSeconds ? Number(TokenExpiresInSeconds) : null,
      refresh_token: RefreshToken || null,
      refresh_token_expiresInSec: RefreshTokenExpiresInSeconds ? Number(RefreshTokenExpiresInSeconds) : null,
      tokencreated: Token ? new Date() : null,
    };

    // Backward-compatible (old) parameters
    const legacyParams = {
      currentUserId: resolvedUserId,
      platformid: String(platformid ?? 4),
      OrgId: OrgId ?? null,
      CreatedBy: createdBy || null,
      Instance_Name: Instance_Name || null,
      Intance_Id: Intance_Id || null,
      Region_Endpoint: Region_Endpoint || null,
      BucketName: BucketName || null,
      AccessKey: AccessKey || null,
      SecretKey: SecretKey || null,
      TimeZone: TimeZone || null,
      Instance_Type: Instance_Type || null,
      Start_Time: toDateOrNull(Start_Time),
      End_Time: toDateOrNull(End_Time),
    };

    const tryExecute = async (params) =>
      executeStoredProcedure(
        "usp_SaveAmazonConnectConfiguration",
        params,
        amazonConnectSaveOutputParams,
      );

    let result;
    try {
      result = await tryExecute(newParams);
    } catch (err) {
      const msg = String(err?.message || "");
      const fallbackNeeded =
        msg.includes("too many arguments") ||
        msg.includes("Too many arguments") ||
        msg.includes("too many") ||
        msg.includes("expects parameter") ||
        msg.includes("expects the parameter");
      if (!fallbackNeeded) throw err;
      result = await tryExecute(legacyParams);
    }

    const statusCode = Number(result.output?.statuscode) || 500;
    const createdAppId = result.output?.appid;

    const isSuccess =
      statusCode >= 200 &&
      statusCode < 300 &&
      createdAppId !== undefined &&
      createdAppId !== null;

    return NextResponse.json(
      {
        success: isSuccess,
        message:
          result.output?.outputmsg ||
          (isSuccess ? "Configuration saved." : "Configuration was not saved."),
        data: { output: result.output },
      },
      { status: isSuccess ? statusCode : 500 },
    );
  } catch (error) {
    console.error("Error while saving Amazon Connect configuration:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Failed to save configuration." },
      { status: 500 },
    );
  }
}
