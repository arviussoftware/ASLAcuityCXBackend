import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    const currentUserId = parseInt(request.headers.get("loggedInUserId"), 10);
    const timezone = request.headers.get("timezone"); // ✅ Timezone from header
    const metricType = searchParams.get("metricType"); // e.g., 'TotalCalls', 'AvgEvalScore', etc.
    const filterType = searchParams.get("filterType") || "All";

    const allowedFilterTypes = ["Daily", "Weekly", "Monthly", "All", "Custom"];
    const isFilterValid = allowedFilterTypes.includes(filterType);

    if (isInvalid(currentUserId)) {
      return NextResponse.json(
        { message: "LoggedInUserId header is missing or invalid." },
        { status: 400 }
      );
    }

    if (!metricType || typeof metricType !== "string") {
      return NextResponse.json(
        { message: "metricType query param is missing or invalid." },
        { status: 400 }
      );
    }

    if (!isFilterValid) {
      return NextResponse.json(
        {
          message: `Invalid filterType. Allowed values: ${allowedFilterTypes.join(
            ", "
          )}`,
        },
        { status: 400 }
      );
    }

    let startDateParam = null;
    let endDateParam = null;

    // Only required for Custom
    if (filterType === "Custom") {
      startDateParam = searchParams.get("startDate");
      endDateParam = searchParams.get("endDate");

      if (!startDateParam || !endDateParam) {
        return NextResponse.json(
          {
            message:
              "For 'Custom' filterType, both startDate and endDate are required in query params.",
          },
          { status: 400 }
        );
      }
    }

    const result = await getMetricDetailsData(
      currentUserId,
      metricType,
      filterType,
      startDateParam,
      endDateParam,
      timezone
    );

    if (result?.recordset) {
      return NextResponse.json(
        {
          message: result.output.outputmsg,
          data: result.recordset,
        },
        { status: result.output.statuscode }
      );
    }

    return NextResponse.json(
      { message: result?.output?.outputmsg || "No data returned." },
      { status: result?.output?.statuscode || 204 }
    );
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

async function getMetricDetailsData(
  currentUserId,
  metricType,
  filterType,
  startDateParam,
  endDateParam,
  timezone
) {
  const inputParams = {
    currentUserId,
    metricType,
    filterType,
    startDateParam,
    endDateParam,
    timezone,
  };

  return await executeStoredProcedure(
    "usp_GetMetricCallDetails",
    inputParams,
    outputmsgWithStatusCodeParams
  );
}
