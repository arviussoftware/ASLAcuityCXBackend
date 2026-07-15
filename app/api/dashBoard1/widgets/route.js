// app/api/dashBoard1/widgets/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const tab = searchParams.get("tab");

    if (!tab) {
      return NextResponse.json({ error: "Tab is required" }, { status: 400 });
    }

    const result = await executeStoredProcedure("GetDashboardWidgetsByTab", {
      TabKey: tab,
    });

    // ✅ NORMALIZE HERE
    const widgets = result?.recordset || [];

    return NextResponse.json({ widgets });
  } catch (err) {
    console.error("Widget fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch widgets" },
      { status: 500 },
    );
  }
}
