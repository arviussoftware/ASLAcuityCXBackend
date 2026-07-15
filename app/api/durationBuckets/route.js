// app/api/durationBuckets/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export async function GET() {
  try {
    const result = await executeStoredProcedure(
      "usp_GetDurationBuckets",
      {},
      {},
    );

    return NextResponse.json({
      buckets: result.recordset,
    });
  } catch (err) {
    return NextResponse.json({ message: err.message }, { status: 500 });
  }
}
