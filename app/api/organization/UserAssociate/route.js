import { NextResponse } from "next/server";
import { executeStoredProcedure, outputmsgParams } from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const { organizationId, userIds, createdBy } = await request.json();

    if (!organizationId) {
      await logWarning("POST /api/organization/UserAssociate", {
        message: "OrganizationId is required.",
      });
      return NextResponse.json(
        { success: false, message: "OrganizationId is required." },
        { status: 400 },
      );
    }

    if (!userIds || userIds.length === 0) {
      await logWarning("POST /api/organization/UserAssociate", {
        message: "User IDs are required.",
        organizationId,
      });
      return NextResponse.json(
        { success: false, message: "User IDs are required." },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure(
      "usp_AssociateExistingUsersToOrganization",
      {
        organizationId,
        userIdsJson: JSON.stringify(userIds),
        createdBy,
      },
      outputmsgParams,
    );

    await logSuccess("POST /api/organization/UserAssociate", {
      message: result?.output?.outputmsg || "Users associated successfully",
      organizationId,
      userCount: userIds.length,
    });

    return NextResponse.json(
      {
        success: true,
        message: result?.output?.outputmsg || "Users associated successfully",
      },
      { status: 200 },
    );
  } catch (error) {
    logError("POST /api/organization/UserAssociate", error);
    console.error("Error associating users:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
