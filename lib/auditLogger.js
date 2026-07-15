import { executeStoredProcedure, connectToDatabase } from "./sql.js";
 
export async function logAudit({
  userId,
  userName,
  actionType,
  interactionId = null,
  description = null,
  ipAddress = null,
}) {
  try {
    if (!userId) return;
    await executeStoredProcedure(
      "usp_InsertAuditTrail",
      {
        userId: parseInt(userId),
        userName: userName || "unknown",
        actionType,
        interactionId,
        description,
        ipAddress: ipAddress || null,
      },
      {},
    );
  } catch (err) {
    console.error(`[audit] ${actionType} failed: ${err.message}`);
  }
}
 
export async function getAuditUser(userId) {
  try {
    if (!userId) {
      return { userId: null, userName: "System" };
    }
    const pool = await connectToDatabase();
    let userName = "Unknown User";
 
    const uRes = await pool.query(
      `SELECT user_login_id FROM public.tblmst_userdetails WHERE "userId" = $1 AND COALESCE("DeleteStatus", 0) = 0`,
      [userId]
    );
    if (uRes.rows[0]?.user_login_id) {
      userName = uRes.rows[0].user_login_id;
    }
    return { userId: Number(userId), userName };
  } catch (error) {
    console.error("Error in getAuditUser:", error);
    return { userId: Number(userId) || null, userName: "System" };
  }
}