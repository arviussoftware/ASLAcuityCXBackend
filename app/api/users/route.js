// app/api/users/route.js
import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  TotalRecords,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { isInvalid } from "@/lib/generic";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || 1);
    const perPage = parseInt(url.searchParams.get("perPage") || 10);
    const search = url.searchParams.get("search") || null;
    const queryType = parseInt(url.searchParams.get("queryType") || 0);
    const isActive = url.searchParams.get("isActive") || null;
    const roleFilter = (url.searchParams.get("roleFilter") || null)?.trim();
    const organizationFilter = (
      url.searchParams.get("organizationFilter") || null
    )?.trim();
    // const platformFilter = (
    //   url.searchParams.get("platformFilter") || null
    // )?.trim();

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      await logWarning(
        "GET /api/users",
        "Missing or invalid Authorization header",
      );
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Token missing",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const token = authHeader.split(" ")[1];

    if (token !== API_SECRET_TOKEN) {
      await logWarning("GET /api/users", "Invalid API token");
      return new Response(
        JSON.stringify({
          success: false,
          message: "Unauthorized: Invalid token",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (isInvalid(loggedInUserId)) {
      await logWarning("GET /api/users", "Invalid loggedInUserId", {
        loggedInUserId,
      });
      return NextResponse.json(
        { message: "Logged-in user ID is missing or invalid." },
        { status: 400 },
      );
    }

    const hasViewPermission = await checkUserPrivilege(
      loggedInUserId,
      MODULES.USER_MANAGEMENT,
      PRIVILEGES.VIEW,
    );

    if (!hasViewPermission) {
      await logWarning(
        "GET /api/users",
        "User lacks permission to view users.",
        { loggedInUserId },
      );
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: No permission to view users.",
        },
        { status: 403 },
      );
    }

    const userDetails = await getUserDetails(
      page,
      perPage,
      search,
      loggedInUserId,
      isActive,
      queryType,
      roleFilter,
      organizationFilter,
      // platformFilter,
    );

    if (userDetails.recordsets.length > 0) {
      const users = userDetails.recordsets[0] || [];

      if (queryType === 0) {
        const totalRecord = await TotalRecords(userDetails.recordsets[1]);

        await logSuccess("GET /api/users", "Users fetched successfully.", {
          queryType,
          currentUserId: loggedInUserId,
          totalRecord,
          userCount: users.length,
        });

        return NextResponse.json(
          {
            message: userDetails.output.outputmsg,
            totalRecord,
            users,
          },
          { status: userDetails.output.statuscode },
        );
      } else {
        await logSuccess("GET /api/users", "Users fetched successfully.", {
          queryType,
          currentUserId: loggedInUserId,
          userCount: users.length,
        });
        return NextResponse.json(
          {
            message: userDetails.output.outputmsg,
            users,
          },
          { status: userDetails.output.statuscode },
        );
      }
    }

    await logWarning(
      "GET /api/users",
      userDetails.output.outputmsg || "No users found.",
      {
        queryType,
        currentUserId: loggedInUserId,
      },
    );

    return NextResponse.json(
      { message: userDetails.output.outputmsg },
      { status: userDetails.output.statuscode },
    );
  } catch (error) {
    await logError("GET /api/users", error);
    console.error("GET /api/users error:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const {
      page = 1,
      perPage = 10,
      search,
      queryType = 0,
      currentUserId,
      isActive,
      roleFilter,
      organizationFilter,
      // platformFilter,
    } = await request.json();

    if (isInvalid(currentUserId)) {
      await logWarning("POST /api/users", "Invalid currentUserId", {
        currentUserId,
      });
      return NextResponse.json(
        {
          message: "Current user ID is invalid or missing in the request body.",
        },
        { status: 400 },
      );
    }

    const userDetails = await getUserDetails(
      page,
      perPage,
      search,
      currentUserId,
      isActive,
      queryType,
      roleFilter,
      organizationFilter,
      // platformFilter,
    );

    if (userDetails.recordsets.length > 0) {
      const users = userDetails.recordsets[0] || [];

      if (queryType === 0) {
        const totalRecord = await TotalRecords(userDetails.recordsets[1]);

        await logSuccess("POST /api/users", "Users fetched successfully.", {
          queryType,
          currentUserId,
          totalRecord,
          userCount: users.length,
        });

        return NextResponse.json(
          {
            message: userDetails.output.outputmsg,
            totalRecord,
            users,
          },
          { status: userDetails.output.statuscode },
        );
      } else {
        await logSuccess("POST /api/users", "Users fetched successfully.", {
          queryType,
          currentUserId,
          userCount: users.length,
        });
        return NextResponse.json(
          {
            message: userDetails.output.outputmsg,
            users,
          },
          { status: userDetails.output.statuscode },
        );
      }
    }

    await logWarning("POST /api/users", "No users found.", {
      queryType,
      currentUserId,
    });

    return NextResponse.json(
      { message: userDetails.output.outputmsg },
      { status: userDetails.output.statuscode },
    );
  } catch (error) {
    await logError("POST /api/users", error);
    console.error("POST /api/users error:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

async function getUserDetails(
  pageNo,
  rowCountPerPage,
  search,
  currentUserId,
  isActive,
  queryType,
  roleFilter,
  organizationFilter,
  // platformFilter,
) {
  const inputParams = {
    pageNo,
    rowCountPerPage,
    search,
    currentUserId,
    isActive,
    querytype: queryType,
    roleFilter,
    organizationIds: organizationFilter, // ✅ Match stored proc param
    // platformFilter,
  };

  const result = await executeStoredProcedure(
    "usp_GetUsersDetails",
    inputParams,
    outputmsgWithStatusCodeParams,
  );

  return result;
}
