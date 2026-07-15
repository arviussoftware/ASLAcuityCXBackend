// app/api/interactions/saveSearch/route.js

import {
  executeStoredProcedure,
  outputmsgWithStatusCodeParams,
} from "@/lib/sql.js";

export async function POST(req) {
  const body = await req.json();

  const { userId, payload } = body;
  const activeStatus = Number(payload?.status ?? 0);

  const result = await executeStoredProcedure(
    "usp_SaveUserSearchHistory",
    {
      UserId: userId,
      SearchPayload: JSON.stringify(payload),
      ActiveStatus: Number.isNaN(activeStatus) ? 0 : activeStatus,
    },
    outputmsgWithStatusCodeParams, // ✅ FIX
  );

  return Response.json({
    message: result.output.outputmsg,
  });
}
