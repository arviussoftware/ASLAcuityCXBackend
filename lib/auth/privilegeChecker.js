import { isInvalid } from "@/lib/generic";
import { isSuperAdminFromRequest } from "@/lib/auth/superAdmin";
import { executeStoredProcedure } from "@/lib/sql.js";

export async function checkUserPrivilege(userId, moduleId, privilegeId) {
  if (isInvalid(userId) || isInvalid(moduleId) || isInvalid(privilegeId)) {
    return false;
  }

  if (await isSuperAdminFromRequest()) {
    return true;
  }

  try {
    console.log(`[checkUserPrivilege] Checking userId=${userId}, moduleId=${moduleId}, privilegeId=${privilegeId}`);
    const res = await executeStoredProcedure("usp_GetPrivilegesByUserid", {
      p_UserId: Number(userId),
      p_ModuleId: Number(moduleId),
      p_OrgIds: null
    });

    const privileges = res?.recordsets?.[0] || [];
    console.log(`[checkUserPrivilege] Retrieved privileges:`, privileges);
    if (!privileges || privileges.length === 0) {
      console.log(`[checkUserPrivilege] No privileges found for user.`);
      return false;
    }

    const matched = privileges.some(row => {
      const uPriv = Number(row.PrivilegeId ?? row.privilegeId);
      const reqPriv = Number(privilegeId);

      if (uPriv === 11) { // NONE
        return false;
      }

      // 1 represents Full Access, allowing all actions on the module
      return uPriv === 1 || uPriv === reqPriv;
    });
    console.log(`[checkUserPrivilege] Matching outcome: ${matched}`);
    return matched;
  } catch (error) {
    console.error("Error in checkUserPrivilege:", error);
    return false; // Deny by default on error
  }
}

