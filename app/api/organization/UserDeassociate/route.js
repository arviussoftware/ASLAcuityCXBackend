// app/api/organization/UserDessociate/route.js
// app/api/organization/UserDeassociate/route.js
import { NextResponse } from "next/server";
import { executeStoredProcedure, outputmsgParams } from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { organizationId, userIds } = await request.json();

    if (!organizationId) {
      await logWarning("POST /api/organization/UserDeassociate", {
        message: "OrganizationId is required.",
      });
      return NextResponse.json(
        { success: false, message: "OrganizationId is required." },
        { status: 400 },
      );
    }

    if (!userIds || userIds.length === 0) {
      await logWarning("POST /api/organization/UserDeassociate", {
        message: "User IDs list is required.",
        organizationId,
      });
      return NextResponse.json(
        { success: false, message: "User IDs list is required." },
        { status: 400 },
      );
    }

    // Pass as JSON array of userId values
    const userIdsJson = JSON.stringify(userIds);

    const result = await executeStoredProcedure(
      "usp_DeassociateUsersFromOrganization",
      {
        organizationId,
        userIdsJson,
      },
      outputmsgParams,
    );

    await logSuccess("POST /api/organization/UserDeassociate", {
      message:
        result?.output?.outputmsg || "Users de-associated successfully",
      organizationId,
      userCount: userIds.length,
    });

    return NextResponse.json(
      {
        success: true,
        message:
          result?.output?.outputmsg || "Users de-associated successfully",
      },
      { status: 200 },
    );
  } catch (error) {
    logError("POST /api/organization/UserDeassociate", error);
    console.error("Error de-associating users:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
