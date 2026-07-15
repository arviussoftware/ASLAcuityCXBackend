import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);
    const timezone = request.headers.get("timezone"); // ✅ Needed now
    const { searchParams } = new URL(request.url);
    const durationBucket = searchParams.get("durationBucket");

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "LoggedInUserId header is missing, undefined, or invalid." },
        { status: 400 }
      );
    }

    const inputParams = {
      currentUserId: loggedInUserId,
    };

    if (durationBucket) {
      inputParams.durationBucket = durationBucket;
    }

    if (timezone) {
      inputParams.timezone = timezone;
    }

    const { recordsets, output } = await executeStoredProcedure(
      "usp_GetEvaluationTimeAnalyzer",
      inputParams,
      outputmsgWithStatusCodeParams
    );

    const durationDistribution = recordsets?.[0] || [];
    const extremeLongEvaluations = recordsets?.[1] || [];

    return NextResponse.json(
      {
        message: output.outputmsg || "Success",
        data: {
          distribution: durationDistribution,
          outliers: extremeLongEvaluations,
        },
      },
      { status: output.statuscode || 200 }
    );
  } catch (error) {
    console.error("API ERROR:", error.message);
    return NextResponse.json(
      { message: error.message || "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
