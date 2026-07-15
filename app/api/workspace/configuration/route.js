import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const platformidParam = searchParams.get("platformid") || searchParams.get("platformId");
    const requestedPlatformId = platformidParam ? Number(platformidParam) : null;

    const result = await getConfigurationData(
      requestedPlatformId && Number.isFinite(requestedPlatformId) ? requestedPlatformId : null,
    );

    if (result.recordset && result.recordset.length > 0) {
      const rawRows = result.recordset;
      const rows =
        requestedPlatformId && Number.isFinite(requestedPlatformId)
          ? rawRows.filter((row) => {
              const pid = Number(
                row?.PlatformId ?? row?.platformId ?? row?.platformid ?? row?.platform ?? NaN,
              );
              return Number.isFinite(pid) && pid === requestedPlatformId;
            })
          : rawRows;

      const columns = rows.length > 0 ? Object.keys(rows[0]) : Object.keys(rawRows[0] || {});

      return NextResponse.json(
        {
          message:
            result.output?.outputmsg ||
            "Configuration data fetched successfully.",
          columns: columns, // dynamic column names
          rows: rows, // grid data
        },
        { status: result.output?.statuscode || 200 },
      );
    } else {
      return NextResponse.json(
        {
          message: "No configuration data found.",
          columns: [],
          rows: [],
        },
        { status: 404 },
      );
    }
  } catch (error) {
    console.error("Error in GetConfiguration API:", error);

    return NextResponse.json(
      {
        message: "Internal server error",
        error: error.message,
      },
      { status: 500 },
    );
  }
}

async function getConfigurationData(platformId = null) {
  const result = await executeStoredProcedure("usp_getconfiguration", {
    ...(platformId ? { PlatformId: Number(platformId) } : {}),
  });
  return result;
}
