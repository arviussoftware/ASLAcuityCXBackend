// app/api/interactions/searchHistory/route.js

import { executeStoredProcedure } from "@/lib/sql.js";

export async function GET(request) {
  const userId = request.headers.get("loggedInUserId");
  const timezone = request.headers.get("timezone");
  const activeStatusHeader = request.headers.get("activeStatus");
  const activeStatus = Number(activeStatusHeader ?? 0);

  const result = await executeStoredProcedure("usp_GetUserSearchHistory", {
    UserId: userId,
    timezone: timezone,
    ActiveStatus: Number.isNaN(activeStatus) ? 0 : activeStatus,
  });

  return Response.json({
    history: result.recordset.map((r) => {
      const payload = JSON.parse(r.SearchPayload);
      const normalizedStatus = String(payload?.status ?? "0");
      const searchType =
        payload?.searchType ||
        (normalizedStatus === "1" ? "evaluation" : "interaction");

      return {
        id: r.SearchId,
        createdAt: r.CreatedAt
          ? new Date(r.CreatedAt)
              .toISOString()
              .replace("T", " ")
              .substring(0, 19)
          : null,
        payload: {
          ...payload,
          status: normalizedStatus,
          searchType,
          viewLabel:
            payload?.viewLabel ||
            (searchType === "evaluation" ? "Evaluations" : "Interactions"),
        },
      };
    }),
  });
}
