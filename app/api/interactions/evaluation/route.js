import { NextResponse } from "next/server";
import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";
import { getAuditUser, logAudit } from "@/lib/auditLogger";
import { isInvalid } from "@/lib/generic";
import { logError } from "@/lib/errorLogger";

export const dynamic = "force-dynamic";

const API_SECRET_TOKEN = process.env.NEXT_PUBLIC_API_TOKEN;

export async function POST(request) {
  try {
    // ── Auth check ─────────────────────────────────────────────────────
    const authHeader = request.headers.get("authorization");
    if (!authHeader || authHeader.split(" ")[1] !== API_SECRET_TOKEN) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const {
      UniqueId,
      //id,
      formId,
      interactionId,
      spentTime,
      jsonData,
      currentUserId,
      scoringMethod,
      totalScore,
      formName,
    } = await request.json();

    // Check if any of the required fields are undefined
    if (
      isInvalid(UniqueId) ||
      //isInvalid(id) ||
      isInvalid(formId) ||
      isInvalid(interactionId) ||
      isInvalid(spentTime) ||
      isInvalid(jsonData) ||
      isInvalid(currentUserId) ||
      isInvalid(scoringMethod) ||
      isInvalid(totalScore)
    ) {
      return NextResponse.json(
        { message: "Request body could not be read properly." },
        { status: 400 }
      );
    }

    const result = await submitEvulationForm(
      UniqueId,
      //id,
      interactionId,
      formId,
      spentTime,
      jsonData,
      currentUserId,
      scoringMethod,
      totalScore
    );

    if (parseInt(result?.output?.statuscode, 10) === 200) {
      const auditUser = await getAuditUser(currentUserId);

      await logAudit({
        userId: auditUser.userId,
        userName: auditUser.userName,
        actionType: "EVALUATION_SUBMITTED",
        interactionId,
        description: `Submitted evaluation form '${formName || formId}' with score ${totalScore}.`,
      });
    }

    return NextResponse.json(
      { message: result.output.outputmsg },
      { status: result.output.statuscode }
    );
  } catch (error) {
    logError(`POST /api/interactions/evaluation`, error);
    if (error instanceof RangeError)
      return NextResponse.json({ message: error.message }, { status: 400 });
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

async function submitEvulationForm(
  UniqueId,
  //Id,
  IdnteractionId,
  FormId,
  SpentTime,
  JsonData,
  currentUserId,
  scoringMethod,
  totalScore
) {
  const inputParams = {
    UniqueId: UniqueId,
    //id: Id,
    interactionId: IdnteractionId,
    formId: FormId,
    spentTime: SpentTime,
    ansJson: JSON.stringify(JsonData), // Stringify JSON data
    evaluationBy: currentUserId,
    scoringMethod: scoringMethod,
    totalScore: totalScore,
  };

  const result = await executeStoredProcedure(
    "usp_SubmitEvaluationForm",
    inputParams,
    outputmsgWithStatusCodeParams
  );

  return result;
}
