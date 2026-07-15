import { NextResponse } from "next/server";
import { executeStoredProcedure } from "@/lib/sql.js";
import PrivilegeModel from "@/lib/models/privilegeview";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import { isValidPositiveInteger } from "@/lib/generic";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { pathname } = new URL(request.url);
    const parts = pathname.split("/");
    const moduleId = parts[parts.length - 1];

    if (!isValidPositiveInteger(moduleId)) {
      await logWarning("GET /api/roleManagement/privileges/[id]", {
        message: "Invalid module ID.",
      });
      return NextResponse.json(
        { success: false, message: "Module ID is required" },
        { status: 400 },
      );
    }

    const result = await getModulePrivileges(moduleId);

    const rows =
      result?.recordset || result?.recordsets?.[0] || result?.rows || [];

    const privilegesData = await setPrivilegesModel(rows);

    await logSuccess("GET /api/roleManagement/privileges/[id]", {
      message: "Privileges fetched successfully",
      moduleId,
      privilegeCount: privilegesData.length,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Privileges fetched successfully",
        privileges: privilegesData,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );
  } catch (error) {
    console.error("Error occurred while processing GET request:", error);
    logError("GET /api/roleManagement/privileges/[id]", error);

    return NextResponse.json(
      {
        success: false,
        message: error.message || "Internal server error",
      },
      { status: 500 },
    );
  }
}

async function getModulePrivileges(moduleId) {
  try {
    const inputParams = {
      p_moduleid: Number(moduleId),
    };

    return await executeStoredProcedure("usp_ModulePrevilege", inputParams);
  } catch (error) {
    console.error("Error executing usp_ModulePrevilege:", error);
    logError(
      "roleManagement/privileges/[id]/route.js:getModulePrivileges",
      error,
    );
    throw error;
  }
}

async function setPrivilegesModel(recordset) {
  try {
    return recordset.map(
      (privilege) =>
        new PrivilegeModel(
          privilege.id ?? privilege.ID,
          privilege.modulename ?? privilege.ModuleName ?? privilege.moduleName,
          privilege.privilegeid ??
            privilege.PrivilegeId ??
            privilege.privilegeId,
          privilege.privilegename ??
            privilege.PrivilegeName ??
            privilege.privilegeName,
          privilege.moduleid ?? privilege.ModuleId ?? privilege.moduleId,
        ),
    );
  } catch (error) {
    console.error("Error occurred while transforming privileges model:", error);
    logError(
      "roleManagement/privileges/[id]/route.js:setPrivilegesModel",
      error,
    );
    throw new Error("Failed to transform privileges data.");
  }
}
