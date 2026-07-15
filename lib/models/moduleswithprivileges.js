import { mapRows, pickFirst } from "@/lib/models/_shared";

export function setPrivilege(rows) {
  return mapRows(rows, (row) => ({
    ...row,
    // ✅ Capital case
    RoleId:      pickFirst(row, ["RoleId",      "roleId",      "roleid"]),
    ModuleId:    pickFirst(row, ["ModuleId",    "moduleId",    "moduleid"]),
    PrivilegeId: pickFirst(row, ["PrivilegeId", "privilegeId", "privilegeid"]),
    UserRole:    pickFirst(row, ["user_role",   "UserRole",    "userRole",   "userrole"]),
    UserId:      pickFirst(row, ["UserId",      "userId",      "userid"]),
    OrgId:       pickFirst(row, ["OrgId",       "orgId",       "orgid"]),
    //camelCase 
    roleId:      pickFirst(row, ["RoleId",      "roleId",      "roleid"]),
    moduleId:    pickFirst(row, ["ModuleId",    "moduleId",    "moduleid"]),
    privilegeId: pickFirst(row, ["PrivilegeId", "privilegeId", "privilegeid"]),
    userRole:    pickFirst(row, ["user_role",   "UserRole",    "userRole",   "userrole"]),
    userId:      pickFirst(row, ["UserId",      "userId",      "userid"]),
    orgId:       pickFirst(row, ["OrgId",       "orgId",       "orgid"]),
  }));
}