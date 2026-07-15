import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  TotalRecords,
  outputmsgParams,
} from "@/lib/sql.js";
import FormsModel from "@/lib/models/forms";
import { MODULES, PRIVILEGES } from "@/lib/constants/privileges";
import { Privilege } from "@/lib/models/privilege";
import { checkUserPrivilege } from "@/lib/auth/privilegeChecker";
import { isInvalid } from "@/lib/generic";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization");
    const loggedInUserId = request.headers.get("loggedInUserId");
    const orgIds =
      request.headers.get("orgIds") || request.headers.get("orgId");

    // 🔐 Step 2: Check if token is missing or incorrect
    if (!authHeader || !authHeader.startsWith("Bearer")) {
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
      return NextResponse.json(
        { message: "Logged-in user ID is missing or invalid." },
        { status: 400 },
      );
    }

    const hasViewPermission = await checkUserPrivilege(
      loggedInUserId,
      MODULES.FORM_DESIGNER,
      PRIVILEGES.VIEW,
      orgIds || null,
    );
    if (!hasViewPermission) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized: No permission to view users.",
        },
        { status: 403 },
      );
    }
    // Fetch forms from the database
    const Forms = await getforms();

    const forms = await setFormsModel(Forms.recordsets[0]);
    const response = new Response(
      JSON.stringify({
        success: true,
        message: "Report-Success",
        forms,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );

    return response;
  } catch (error) {
    console.log("Error occurred while processing GET request:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Internal server error" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
}

async function getforms() {
  try {
    const result = await executeStoredProcedure("usp_GetAllForms");
    return result;
  } catch (error) {
    console.log("Error executing stored procedure:", error);
    throw error;
  }
}

async function setFormsModel(recordset) {
  try {
    const forms = await recordset.map(
      (form) =>
        new FormsModel(
          form.Form_id,
          form.form_name,
          form.form_description,
          form.form_json,
          form.Status,
          form.Modify_date,
          form.UniqueId,
          form.Creation_by,
          form.Modify_by,
          form.Version,
          form.Passing_score,
          form.interactiontype,
          form.InteractionTypeName,
          form.Max_score,
        ),
    );
    return forms;
  } catch (error) {
    console.log("Error occurred while transforming forms model:", error);
    throw new Error("Failed to transform forms data.");
  }
}
