 import { NextResponse } from "next/server";
import { isInvalid } from "@/lib/generic";
import {
    executeStoredProcedure,
    outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
export const dynamic = "force-dynamic";

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const currentUserId = parseInt(request.headers.get("loggedInUserId"), 10);
        const formType = searchParams.get("formType");

        // Validate currentUserId
        if (isInvalid(currentUserId)) {
            return NextResponse.json(
                { message: "LoggedInUserId header is missing or invalid." },
                { status: 400 }
            );
        }

        // Validate formType
        if (!formType || typeof formType !== "string") {
            return NextResponse.json(
                { message: "formType query param is missing or invalid" },
                { status: 400 }
            );
        }

        // Call the stored procedure
        const result = await getFormData(currentUserId, formType);

        const statusCode = result?.output?.statuscode || 500;
        const message = result?.output?.outputmsg || "No message returned.";

        if (result?.recordset && result.recordset.length > 0) {
            return NextResponse.json(
                {
                    message,
                    data: result.recordset,
                },
                { status: statusCode }
            );
        }

        return NextResponse.json(
            {
                message,
                data: [],
            },
            { status: statusCode }
        );
    } catch (error) {
        console.error("API error:", error);
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
}

async function getFormData(currentUserId, formType) {
    const inputParams = {
        currentUserId,
        formType,
    };

    return await executeStoredProcedure(
        "usp_GetFormDetailsByType",
        inputParams,
        outputmsgWithStatusCodeParams
    );
}
