import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { isInvalid, isValidPositiveInteger } from "@/lib/generic";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

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

export async function POST(request, { params }) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const routeId = resolvedParams?.id;

    if (!isValidPositiveInteger(routeId)) {
      await logWarning("POST /api/organization/EditChild/[id]", {
        message: "Malformed id path parameter.",
        routeId,
      });
      return NextResponse.json(
        { message: "Invalid organization identifier." },
        { status: 400 },
      );
    }

    const { name, description, userId, OrganizationId } = await request.json();

    if (Number(routeId) !== Number(OrganizationId)) {
      await logWarning("POST /api/organization/EditChild/[id]", {
        message: "Path id and body OrganizationId mismatch.",
        routeId,
        OrganizationId,
      });
      return NextResponse.json(
        { message: "Organization identifier mismatch." },
        { status: 400 },
      );
    }

    if (!name) {
      await logWarning("POST /api/organization/EditChild/[id]", {
        message: "Organization name required.",
        OrganizationId,
      });
      return NextResponse.json(
        {
          success: false,
          message: "Organization name required.",
        },
        { status: 400 },
      );
    }

    // Apply smartCapitalize only to name
    const capitalizedName = smartCapitalize(name);

    const result = await editOrganization({
      name: capitalizedName,
      description,
      userId,
      OrganizationId,
    });

    // ...rest unchanged

    if (parseInt(result.output.statuscode) === 200) {
      await logSuccess("POST /api/organization/EditChild/[id]", {
        message: result.output.outputmsg || "Organization updated successfully",
        OrganizationId,
      });
      return NextResponse.json(
        { success: true, message: result.output.outputmsg },
        { status: 200 },
      );
    } else {
      await logWarning("POST /api/organization/EditChild/[id]", {
        message: result.output.outputmsg || "Organization update failed.",
        OrganizationId,
        statusCode: result.output.statuscode,
      });
      return NextResponse.json({
        success: false,
        message: result.output.outputmsg,
      });
    }
  } catch (error) {
    logError("POST /api/organization/EditChild/[id]", error);
    return NextResponse.json({
      success: false,
      message: "Internal server error.",
    });
  }
}

async function editOrganization({ name, description, userId, OrganizationId }) {
  try {
    const inputParams = {
      Name: name,
      Description: description,
      userId: userId,
      OrganizationId: OrganizationId,
    };

    const result = await executeStoredProcedure(
      "usp_editorganization",
      inputParams,
      outputmsgWithStatusCodeParams,
    );

    return result;
  } catch (error) {
    console.error("Error executing stored procedure:", error);
    throw new Error("Failed to save organization.");
  }
}
