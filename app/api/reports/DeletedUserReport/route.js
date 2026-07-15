// app/api/reports/DeletedUserReport/route.js

import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { isInvalid } from "@/lib/generic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = parseInt(request.headers.get("loggedInUserId"), 10);
    const orgIds = request.headers.get("orgIds") || request.headers.get("orgId");

    const {
      filter,
      StartDate,
      EndDate,
      search,
      roleFilter,
      organizationIds,
      pageNo,
      rowCountPerPage,
      queryType,
    } = await request.json();

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      return NextResponse.json({ success: false, message: "Invalid token" }, { status: 401 });
    }

    if (isInvalid(loggedInUserId)) {
      return NextResponse.json(
        { success: false, message: "Invalid user" },
        { status: 400 },
      );
    }

    const hasViewPermission = await checkUserPrivilege(
      loggedInUserId,
      MODULES.REPORTS,
      PRIVILEGES.VIEW,
      orgIds || null,
    );

    if (!hasViewPermission) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 403 },
      );
    }

    if (!filter) {
      return NextResponse.json(
        { success: false, message: "Filter type is required." },
        { status: 400 },
      );
    }

    if (filter === "DATE_RANGE" && (!StartDate || !EndDate)) {
      return NextResponse.json(
        {
          success: false,
          message: "StartDate and EndDate are required for DATE_RANGE filter.",
        },
        { status: 400 },
      );
    }

    const result = await executeStoredProcedure("usp_DeletedUsersReport", {
      userId: loggedInUserId,
      DateFilter: filter,
      StartDate,
      EndDate,
      search,
      roleFilter: Array.isArray(roleFilter) ? roleFilter.join(",") : roleFilter,
      organizationIds: Array.isArray(organizationIds)
        ? organizationIds.join(",")
        : organizationIds,
      pageNo,
      rowCountPerPage,
      queryType,
    });

    if (queryType === 0) {
      return NextResponse.json({
        success: true,
        data: {
          users: result.recordsets[0],
          totalCount: result.recordsets[1][0].TotalCount,
        },
      });
    } else {
      return NextResponse.json({
        success: true,
        data: {
          users: result.recordsets[0],
        },
      });
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, message: "Internal error" },
      { status: 500 },
    );
  }
}
