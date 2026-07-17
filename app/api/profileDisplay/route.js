import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { userId } = await req.json();
    const encryptionKey =
      process.env.NEXT_PUBLIC_CLIENT_ENCRYPT_KEY ||
      process.env.NEXT_PUBLIC_ENCRYPTION_KEY ||
      process.env.ENCRYPTION_KEY;

    if (!encryptionKey) {
      console.error("ENCRYPTION_KEY environment variable is not set");
      return NextResponse.json(
        { message: "Server configuration error" },
        { status: 500 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { message: "Missing required parameter: userId" },
        { status: 400 }
      );
    }

    const profileResult = await executeStoredProcedure(
      "usp_profiledisplay1",
      {
        p_UserId: Number(userId),
        ...(encryptionKey ? { p_encryption_key: encryptionKey } : {}),
      }
    );

    // Debug logging removed — avoid logging full profile (PII) to stdout

    if (
      !profileResult?.recordset ||
      profileResult.recordset.length === 0
    ) {
      return NextResponse.json(
        { message: "Profile not found or inactive" },
        { status: 404 }
      );
    }

    const userData = { ...profileResult.recordset[0] };
    if (userData.profile_picture && Buffer.isBuffer(userData.profile_picture)) {
      const buf = userData.profile_picture;
      let mimeType = "image/png";
      if (buf.length > 4) {
        const hex = buf.slice(0, 4).toString("hex").toUpperCase();
        if (hex === "89504E47") {
          mimeType = "image/png";
        } else if (hex.startsWith("FFD8FF")) {
          mimeType = "image/jpeg";
        } else if (hex === "47494638") {
          mimeType = "image/gif";
        } else if (buf.slice(8, 12).toString("ascii") === "WEBP") {
          mimeType = "image/webp";
        }
      }
      userData.profile_picture = `data:${mimeType};base64,${buf.toString("base64")}`;
    }

    return NextResponse.json(
      {
        message: "Profile fetched successfully",
        data: userData,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in profileDisplay API:", error);

    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
