import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { getAuditUser, logAudit } from "@/lib/auditLogger";
import { isInvalid } from "@/lib/generic";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request, { params }) {
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

    const { currentUserId } = await request.json();
    const uniqueid = params.id;

    if (isInvalid(uniqueid) || isInvalid(currentUserId)) {
      return NextResponse.json(
        { success: false, message: "Invalid preview audit request." },
        { status: 400 },
      );
    }

    const formResult = await executeStoredProcedure(
      "usp_GetFormById",
      { uniqueid },
      {},
    );

    const form = formResult?.recordset?.[0];

    if (!form) {
      return NextResponse.json(
        { success: false, message: "Form not found." },
        { status: 404 },
      );
    }

    const auditUser = await getAuditUser(currentUserId);

    await logAudit({
      userId: auditUser.userId,
      userName: auditUser.userName,
      actionType: "FORM_PREVIEWED",
      description: `Previewed form '${form.form_name}'.`,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Form preview audit error:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
