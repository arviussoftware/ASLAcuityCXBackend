export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import { executeStoredProcedure, outputmsgWithStatusCodeParams } from "@/lib/sql.js";

export async function GET(request) {
  try {
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { message: "LoggedInUserId header is missing, undefined, or invalid." },
        { status: 400 },
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const roleFilter = (searchParams.get("roleFilter") || null)?.trim();
    const organizationIds = (
      searchParams.get("organizationIds") || null
    )?.trim();
    const isActive = searchParams.get("isActive");
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");

    const result = await getFilteredUsers(
      loggedInUserId,
      roleFilter,
      organizationIds,
      isActive,
      fromDate,
      toDate,
    );

    const { output = {}, recordsets = [] } = result;

    const usersData = recordsets[0] || [];

    return NextResponse.json(
      {
        message: output.outputmsg || "Success",
        data: {
          users: usersData,
        },
      },
      { status: output.statuscode || 200 },
    );
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { message: error.message || "Internal server error." },
      { status: 500 },
    );
  }
}

async function getFilteredUsers(
  currentUserId,
  roleFilter,
  organizationIds,
  isActive,
  fromDate,
  toDate,
) {
  const inputParams = {
    roleFilter: roleFilter || null,
    organizationIds: organizationIds || null,
    isActive: isActive ? parseInt(isActive, 10) : null,
    fromDate: fromDate ? new Date(fromDate) : null,
    toDate: toDate ? new Date(toDate) : null,
    currentUserId,
  };

  try {
    const result = await executeStoredProcedure(
      "usp_GetFilteredUsers",
      inputParams,
      outputmsgWithStatusCodeParams,
    );
    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error("Failed to retrieve filtered users from the database.");
  }
}
