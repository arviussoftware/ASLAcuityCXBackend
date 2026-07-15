import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";
import ModulesModel from "@/lib/models/moduleview";
import {
  isSuperAdminFromRequest,
  isSuperAdminRoleId,
} from "@/lib/auth/superAdmin";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request, { params }) {
  try {
    const authHeader = request.headers.get("authorization");
    const id = params.id;

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      await logWarning("GET /api/roleManagement/[id]", {
        message: "Unauthorized: Token missing",
        id,
      });
      return new Response(
        JSON.stringify({ success: false, message: "Unauthorized: Token missing" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      await logWarning("GET /api/roleManagement/[id]", {
        message: "Unauthorized: Invalid token",
        id,
      });
      return new Response(
        JSON.stringify({ success: false, message: "Unauthorized: Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!id || typeof id !== "string") {
      await logWarning("GET /api/roleManagement/[id]", {
        message: "Invalid id provided to fetch the roleManagement record.",
      });
      return NextResponse.json(
        { success: false, message: "Invalid id provided to fetch the roleManagement record." },
        { status: 400 }
      );
    }

    const isSuperAdmin = await isSuperAdminFromRequest();
    if (!isSuperAdmin && isSuperAdminRoleId(id)) {
      await logWarning("GET /api/roleManagement/[id]", {
        message: "You are not allowed to access Super Admin role.",
        id,
      });
      return NextResponse.json(
        { success: false, message: "You are not allowed to access Super Admin role.", modules: [] },
        { status: 403 }
      );
    }

    // Step 1: Status check
    const statusResult = await executeStoredProcedure(
      "usp_GetModules",
      { p_id: id },
      outputmsgWithStatusCodeParams
    );

    const statusCode = statusResult?.output?.statuscode ?? statusResult?.recordset?.[0]?.p_statuscode;
    const outputMsg  = statusResult?.output?.outputmsg  ?? statusResult?.recordset?.[0]?.p_outputmsg;

    if (Number(statusCode) === 404) {
      await logWarning("GET /api/roleManagement/[id]", {
        message: outputMsg || "No role found for the given ID",
        id,
      });
      return NextResponse.json(
        { success: false, message: outputMsg || "No role found for the given ID", modules: [] },
        { status: 404 }
      );
    }

    // Step 2: Modules data fetch
    const dataResult = await executeStoredProcedure(
      "usp_GetModules_Data",
      { p_id: id }
    );

    const recordset = dataResult?.recordset || dataResult?.recordsets?.[0];

    if (!recordset || recordset.length === 0) {
      await logWarning("GET /api/roleManagement/[id]", {
        message: outputMsg || "No modules found.",
        id,
      });
      return NextResponse.json(
        { success: false, message: outputMsg || "No modules found.", modules: [] },
        { status: 404 }
      );
    }

    const modulesData = await setModulesModel(recordset);

    await logSuccess("GET /api/roleManagement/[id]", {
      message: "Modules fetched successfully",
      id,
      moduleCount: modulesData.length,
    });

    return NextResponse.json(
      { success: true, message: "Modules fetched successfully", modules: modulesData },
      { status: 200 }
    );

  } catch (error) {
    console.error("Error occurred while processing GET request:", error);
    logError("GET /api/roleManagement/[id]", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
}

async function setModulesModel(recordset) {
  if (!Array.isArray(recordset)) {
    throw new Error("Invalid recordset passed to setModulesModel");
  }
  const modules = recordset.map(
    (module) => new ModulesModel(module.ID, module.ModuleName)
  );
  return modules;
}
