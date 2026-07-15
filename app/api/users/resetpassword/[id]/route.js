import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { getAuditUser, logAudit } from "@/lib/auditLogger";
import { isInvalid } from "@/lib/generic";
import { logError, logSuccess, logWarning } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";
const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request, { params }) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const authHeader = request.headers.get("authorization");
    const userId = resolvedParams?.id;
    const { oldPassword, newPassword, currentUserId } = await request.json();

    if (!authHeader || !authHeader.startsWith("Bearer")) {
      await logWarning(
        "POST /api/users/resetpassword/[id]",
        "Missing or invalid Authorization header",
      );
      return NextResponse.json(
        { success: false, message: "Unauthorized: Token missing" },
        { status: 401 },
      );
    }

    const token = authHeader.split(" ")[1];
    if (token !== API_SECRET_TOKEN) {
      await logWarning(
        "POST /api/users/resetpassword/[id]",
        "Invalid API token",
      );
      return NextResponse.json(
        { success: false, message: "Unauthorized: Invalid token" },
        { status: 401 },
      );
    }

    if (
      isInvalid(oldPassword) ||
      isInvalid(newPassword) ||
      isInvalid(currentUserId)
    ) {
      await logWarning(
        "POST /api/users/resetpassword/[id]",
        "Missing required fields for password reset.",
        { currentUserId },
      );
      return NextResponse.json(
        { message: "Request body or parameter could not be read properly." },
        { status: 400 },
      );
    }

    if (oldPassword === newPassword) {
      await logWarning(
        "POST /api/users/resetpassword/[id]",
        "New password same as old password.",
        { currentUserId },
      );
      return NextResponse.json(
        {
          message:
            "New password can't be the same as old password, please choose a different password.",
        },
        { status: 403 },
      );
    }

    if (userId != currentUserId) {
      await logWarning(
        "POST /api/users/resetpassword/[id]",
        "Attempt to reset another user's password.",
        { userId, currentUserId },
      );
      return NextResponse.json(
        {
          message:
            "You do not have access to reset the password of another user.",
        },
        { status: 403 },
      );
    }

    const updateResult = await resetPassword(
      userId,
      oldPassword,
      newPassword,
      currentUserId,
    );

    // Guard: if procedure returned nothing, treat it as a 500
    // Guard: if procedure returned nothing
    if (!updateResult?.output) {
      await logError(
        "POST /api/users/resetpassword/[id]",
        new Error(
          "resetPassword returned no output — procedure may have failed silently",
        ),
      );
      return NextResponse.json(
        { message: "Password reset failed. Please try again." },
        { status: 500 },
      );
    }

    // ← ADD THIS: log when procedure itself reports a 500
    if (parseInt(updateResult?.output?.statuscode, 10) === 500) {
      await logError(
        "POST /api/users/resetpassword/[id]",
        new Error(`Procedure error: ${updateResult.output.outputmsg}`),
      );
      return NextResponse.json(
        { message: updateResult.output.outputmsg },
        { status: 500 },
      );
    }

    if (parseInt(updateResult?.output?.statuscode, 10) === 200) {
      const auditUser = await getAuditUser(currentUserId);

      await logAudit({
        userId: auditUser.userId,
        userName: auditUser.userName,
        actionType: "PASSWORD_RESET",
        description: "User changed account password successfully.",
      });

      await logSuccess("POST /api/users/resetpassword/[id]", "Password reset successfully.", {
        userId,
        currentUserId,
      });
    }

    return NextResponse.json(
      { message: updateResult.output.outputmsg },
      { status: updateResult.output.statuscode },
    );
  } catch (error) {
    await logError("POST /api/users/resetpassword/[id]", error); // ← add this
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

async function resetPassword(id, oldPass, newPass, updateBy) {
  try {
    // ← add try/catch
    const inputParams = {
      userId: id,
      oldPassword: oldPass,
      newPassword: newPass,
      updatedBy: updateBy,
    };

    const result = await executeStoredProcedure(
      "usp_ResetPassword",
      inputParams,
      outputmsgWithStatusCodeParams,
    );
    return result;
  } catch (error) {
    await logError("resetPassword", error); // ← add this
    throw error; // re-throw so the POST handler's catch also fires
  }
}

async function getHashPasswordById(userId) {
  try {
    // ← add try/catch
    const inputParams = { userId };

    const result = await executeStoredProcedure(
      "usp_GetHashPasswordById",
      inputParams,
      outputmsgWithStatusCodeParams,
    );
    return result;
  } catch (error) {
    await logError("getHashPasswordById", error); // ← add this
    throw error;
  }
}
