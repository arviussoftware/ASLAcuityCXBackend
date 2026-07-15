import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import {
  PAGINATION_OUTPUT_PARAMS, checkAuthOnly, ok, internal, toIntParam, readSpResult
} from "@/lib/route-helpers";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const requestId = crypto.randomUUID();
  try {
    const authErr = checkAuthOnly(request);
    if (authErr) return authErr;

    const { searchParams } = new URL(request.url);
    const platformId  = toIntParam(searchParams.get("platformId"));
    let pageNumber    = toIntParam(searchParams.get("pageNumber")) ?? 1;
    let pageSize      = toIntParam(searchParams.get("pageSize"))   ?? 10;

    if (pageNumber < 1) pageNumber = 1;
    if (pageSize   < 1) pageSize   = 10;
    if (pageSize > 100) pageSize   = 100;

    if (searchParams.get("platformId") && platformId === null)
      return NextResponse.json({ success: false, message: "platformId must be a valid integer." }, { status: 400 });

    const params = {
      PlatformId:  platformId,
      PageNumber:  pageNumber,
      PageSize:    pageSize,
    };

    const result = await executeStoredProcedure(
      "usp_GetExportConfigurations",
      params,
      PAGINATION_OUTPUT_PARAMS,
    );

    const { statusCode, message, recordsets, outputParams } = readSpResult(result);

    if (statusCode === 200) {
      const configs     = recordsets?.[0] ?? [];   // main list
      const mappings    = recordsets?.[1] ?? [];   // org+agent rows

      // Group mappings by ExportConfigId
      const mappingMap = {};
      for (const row of mappings) {
        if (!mappingMap[row.ExportConfigId]) mappingMap[row.ExportConfigId] = [];
        mappingMap[row.ExportConfigId].push({
          orgId:     row.OrganizationId,
          orgName:   row.org_name,
          agentId:   row.AgentId   ?? null,
          agentName: row.AgentName ?? null,
          loginId:   row.LoginId   ?? null,
        });
      }

      // Attach mappings to each config and redact secrets
      const data = configs.map((cfg) => ({
        ...cfg,
        // Redact secrets so they are never leaked to the client browser
        S3SecretKey: cfg.S3SecretKey || cfg.s3secretkey || cfg.s3SecretKey ? "********" : null,
        SftpPassword: cfg.SftpPassword || cfg.sftppassword || cfg.sftpPassword ? "********" : null,
        SftpSshKey: cfg.SftpSshKey || cfg.sftpsshkey || cfg.sftpSshKey ? "********" : null,
        GcpServiceKey: cfg.GcpServiceKey || cfg.gcpservicekey || cfg.gcpServiceKey ? "********" : null,
        AzureConnection: cfg.AzureConnection || cfg.azureconnection || cfg.azureConnection ? "********" : null,
        // normalize naming so UI can reliably read it (some DBs/procs differ in casing)
        ExportMetadataColumn:
          cfg?.ExportMetadataColumn
          ?? cfg?.exportMetadataColumn
          ?? cfg?.ExportMetaDataColumn
          ?? cfg?.Export_Metadata_Column
          ?? null,
        orgAgentMappings: mappingMap[cfg.Id] ?? [],
      }));


      const totalRecords =
        outputParams?.TotalCount ?? outputParams?.totalcount ?? 0;
      const totalPages   = Math.ceil(totalRecords / pageSize) || 1;

      return ok({
        message,
        data,
        pagination: {
          currentPage:     pageNumber,
          pageSize,
          totalRecords,
          totalPages,
          hasNextPage:     pageNumber < totalPages,
          hasPreviousPage: pageNumber > 1,
        },
      });
    }

    return NextResponse.json(
      { success: false, message },
      { status: statusCode >= 400 ? statusCode : 500 },
    );
  } catch (error) {
    await logError("GET /api/workFlow/getExportConfigurations", error, { requestId });
    console.error(`[getExportConfigurations] requestId=${requestId}`, error);
    return internal();
  }
}
