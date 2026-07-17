import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

const PAGINATION_OUTPUT_PARAMS = [
  { name: "statuscode", type: "Int", direction: "output" },
  { name: "outputmsg", type: "VarChar", size: 255, direction: "output" },
];

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (
      !authHeader?.startsWith("Bearer ") ||
      authHeader.split(" ")[1] !== API_SECRET_TOKEN
    ) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const platformId = parseInt(searchParams.get("platformId"));
    const instanceName = searchParams.get("instanceName");
    const pageNumber = parseInt(searchParams.get("pageNumber") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "50");

    if (!platformId || !instanceName) {
      return NextResponse.json(
        { success: false, message: "platformId and instanceName are required" },
        { status: 400 }
      );
    }

    const params = {
      Platformid: platformId,
      InstanceName: instanceName,
      PageNumber: pageNumber,
      PageSize: pageSize,
    };

    const result = await executeStoredProcedure(
      "usp_GetTranscribableInteractions",
      params,
      PAGINATION_OUTPUT_PARAMS
    );

    const statusCode = Number(result?.output?.statuscode ?? 500);
    const outputMsg = String(result?.output?.outputmsg ?? "Unknown error");

    if (statusCode === 200) {
      const data = result?.recordset ?? [];
      const totalRecords = data.length > 0 ? data[0].TotalRecords : 0;

      return NextResponse.json({
        success: true,
        message: outputMsg,
        data: data,
        pagination: {
          currentPage: pageNumber,
          pageSize: pageSize,
          totalRecords: totalRecords,
          totalPages: Math.ceil(totalRecords / pageSize),
        },
      });
    }

    return NextResponse.json(
      { success: false, message: outputMsg },
      { status: statusCode >= 400 ? statusCode : 500 }
    );
  } catch (error) {
    await logError("GET /api/workFlow/getTranscribableInteractions", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}
