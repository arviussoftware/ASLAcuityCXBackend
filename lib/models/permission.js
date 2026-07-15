import { mapRows, pickFirst } from "@/lib/models/_shared";

export function setPermissionModel(rows) {
  return mapRows(rows, (row) => ({
    id: pickFirst(row, ["id", "Id", "ID"]),
    roleId: pickFirst(row, ["RoleId", "roleId"]),
    moduleId: pickFirst(row, ["ModuleId", "moduleId"]),
    privilegeId: pickFirst(row, ["PrivilegeId", "privilegeId"]),
    ...row,
  }));
}
