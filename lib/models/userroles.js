import { mapRows, pickFirst } from "@/lib/models/_shared";

export function setUsersRolesModel(rows) {
  return mapRows(rows, (row) => ({
    roleId: pickFirst(row, ["roleId", "RoleId", "ID", "roleid"]),
    roleName: pickFirst(row, ["roleName", "RoleName", "user_role", "rolename"]),
    ...row,
  }));
}
