// app/api/dashBoard1/user-config/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";

export async function GET(req) {
  try {
    const userId = req.headers.get("loggedInUserId");
    const { searchParams } = new URL(req.url);
    const tab = searchParams.get("tab");

    if (!userId || !tab) {
      return NextResponse.json(
        { error: "UserId & Tab required" },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure("GetUserDashboardConfig", {
      UserId: userId,
      TabKey: tab,
    });

    return NextResponse.json({
      widgets: result.recordsets[0] || [],
      layout: result.recordsets[1]?.[0]?.LayoutJson || null,
    });
  } catch (err) {
    console.error("Get dashboard config error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();

    await executeStoredProcedure("SaveUserDashboardLayout", {
      UserId: body.userId,
      TabKey: body.tab,
      LayoutJson: JSON.stringify(body.layouts),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Save layout error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PUT(req) {
  try {
    const body = await req.json();

    await executeStoredProcedure("SaveUserWidget", {
      UserId: body.userId,
      TabKey: body.tab,
      WidgetKey: body.widgetKey,
      IsVisible: body.isVisible,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Save widget error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
