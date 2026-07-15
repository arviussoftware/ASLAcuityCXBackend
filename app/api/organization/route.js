//app/api/organization/route.js
import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { isInvalid } from "@/lib/generic";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

const smartCapitalize = (str) => {
  if (!str) return "";

  return str
    .split(" ")
    .map((word) => {
      if (word === word.toUpperCase()) {
        // It's fully capitalized (acronym or emphasized), leave as-is
        return word;
      }
      if (word.length === 0) return "";

      // Capitalize only the first letter, keep the rest lowercase
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
};

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization");
    let {
      name,
      description,
      parentId,
      userId,
      isActive = 1,
    } = await request.json();

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      await logWarning("POST /api/organization", {
        message: "Unauthorized: Token missing",
      });
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
      await logWarning("POST /api/organization", {
        message: "Unauthorized: Invalid token",
      });
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

    if (isInvalid(userId)) {
      await logWarning("POST /api/organization", {
        message: "Logged-in user ID is missing or invalid.",
      });
      return NextResponse.json(
        { message: "Logged-in user ID is missing or invalid." },
        { status: 400 },
      );
    }

    const hasViewPermission = await checkUserPrivilege(
      userId,
      MODULES.ORGANIZATION,
      PRIVILEGES.VIEW,
    );
    if (!hasViewPermission) {
      await logWarning("POST /api/organization", {
        message: "Unauthorized: No permission to view organization.",
        userId,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: No permission to view organization.",
        },
        { status: 403 },
      );
    }

    // Validate required fields
    if (!name) {
      await logWarning("POST /api/organization", {
        message: "Organization name required.",
        userId,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Organization name required.",
        },
        { status: 400 },
      );
    }

    // Apply smartCapitalize to name and description
    name = smartCapitalize(name);
    if (description) {
      description = smartCapitalize(description);
    }

    // Call function to save organization
    const result = await saveOrganization({
      name,
      description,
      parentId,
      userId,
      isActive, // ✅ Will always have a value (either passed or 1)
    });

    // Check output status and respond accordingly
    if (parseInt(result.output.statuscode) === 200) {
      await logSuccess("POST /api/organization", {
        message: result.output.outputmsg || "Organization saved successfully",
        userId,
        name,
      });
      return NextResponse.json(
        { success: true, message: result.output.outputmsg },
        { status: 200 },
      );
    } else {
      await logWarning("POST /api/organization", {
        message: result.output.outputmsg || "Organization save failed.",
        userId,
        name,
        statusCode: result.output.statuscode,
      });
      return NextResponse.json(
        { success: false, message: result.output.outputmsg },
        // { status: result.output.statuscode }
      );
    }
  } catch (error) {
    logError("POST /api/organization", error);
    return NextResponse.json(
      { success: false, message: "Internal server error." },
      // { status: 500 }
    );
  }
}

async function saveOrganization({
  name,
  description,
  parentId,
  userId,
  isActive,
}) {
  try {
    const inputParams = {
      Name: name,
      Description: description,
      parentId: parentId,
      userId: userId,
      isActive: isActive,
    };

    const result = await executeStoredProcedure(
      "usp_saveorganization",
      inputParams,
      outputmsgWithStatusCodeParams,
    );

    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error("Failed to save organization.");
  }
}
