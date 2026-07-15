// app/api/user-table-preferences/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { isInvalid } from "@/lib/generic";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;
const GET_PREFERENCE_PROCEDURE = "public.usp_GetUserPagePreference";
const SAVE_PREFERENCE_PROCEDURE = "public.usp_SaveUserPagePreference";

function parsePreferenceValue(value) {
  if (value == null) {
    return null;
  }

  let current = value;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (current && typeof current === "object") {
      return current;
    }

    if (typeof current !== "string") {
      return null;
    }

    try {
      current = JSON.parse(current);
    } catch {
      return null;
    }
  }

  return current && typeof current === "object" ? current : null;
}

function normalizePreferenceForSave(preference) {
  if (preference && typeof preference === "object") {
    return preference;
  }

  if (typeof preference === "string") {
    return parsePreferenceValue(preference);
  }

  return null;
}

async function validateAuth(request) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 },
      ),
    };
  }

  const token = authHeader.split(" ")[1];

  if (token !== API_SECRET_TOKEN) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 },
      ),
    };
  }

  return { ok: true };
}

export async function GET(request) {
  const auth = await validateAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const headerUserId = request.headers.get("loggedinuserid") || request.headers.get("loggedInUserId");
    const rawUserId = headerUserId || searchParams.get("userId");
    const pageKey = searchParams.get("pageKey");

    if (isInvalid(rawUserId) || !pageKey) {
      return NextResponse.json(
        { success: false, message: "userId and pageKey are required." },
        { status: 400 },
      );
    }

    const userId = Number(rawUserId);

    if (Number.isNaN(userId) || userId <= 0) {
      return NextResponse.json(
        { success: false, message: "userId must be a valid positive number." },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure(GET_PREFERENCE_PROCEDURE, {
      p_userid: userId,
      p_pagekey: String(pageKey),
    });

    // SP returns cursor rows via recordsets[0]; fallback to recordset
    const row = result.recordsets?.[0]?.[0] ?? result.recordset?.[0];

    const preference = parsePreferenceValue(row?.PreferenceJson);

    return NextResponse.json({
      success: true,
      preference,
      updatedAt: row?.UpdatedAt ?? null,
    });
  } catch (error) {
    console.error("GET /api/user-table-preferences error:", error);

    if (
      error.message?.includes("does not exist") ||
      error.message?.includes("routine") ||
      error.message?.includes("42883")
    ) {
      return NextResponse.json({
        success: true,
        setupRequired: true,
        preference: null,
        message:
          "Stored procedures usp_GetUserPagePreference and usp_SaveUserPagePreference are required.",
      });
    }

    return NextResponse.json(
      {
        success: false,
        message: error.message || "Failed to fetch preference.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  const auth = await validateAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { userId, pageKey, preference } = await request.json();
    const headerUserId = request.headers.get("loggedinuserid") || request.headers.get("loggedInUserId");
    const rawUserId = headerUserId || userId;

    if (isInvalid(rawUserId) || !pageKey) {
      return NextResponse.json(
        { success: false, message: "userId and pageKey are required." },
        { status: 400 },
      );
    }

    const normalizedUserId = Number(rawUserId);

    if (Number.isNaN(normalizedUserId) || normalizedUserId <= 0) {
      return NextResponse.json(
        { success: false, message: "userId must be a valid positive number." },
        { status: 400 },
      );
    }

    const normalizedPreference = normalizePreferenceForSave(preference);

    if (!normalizedPreference) {
      return NextResponse.json(
        { success: false, message: "preference must be a JSON object." },
        { status: 400 },
      );
    }

    await executeStoredProcedure(SAVE_PREFERENCE_PROCEDURE, {
      p_userid: normalizedUserId,
      p_pagekey: String(pageKey),
      p_preferencejson: JSON.stringify(normalizedPreference),
    });

    return NextResponse.json({
      success: true,
      message: "Preference saved successfully.",
    });
  } catch (error) {
    console.error("POST /api/user-table-preferences error:", error);

    if (
      error.message?.includes("does not exist") ||
      error.message?.includes("routine") ||
      error.message?.includes("42883")
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Stored procedures usp_GetUserPagePreference and usp_SaveUserPagePreference are missing. Run the SQL script first.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: error.message || "Failed to save preference.",
      },
      { status: 500 },
    );
  }
}
