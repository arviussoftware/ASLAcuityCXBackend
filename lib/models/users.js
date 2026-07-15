import { mapRows, pickFirst } from "@/lib/models/_shared";

export function setUsersModel(rows) {
  return mapRows(rows, (row) => ({
    userId: pickFirst(row, ["userId", "UserId", "ID"]),
    loginId: pickFirst(row, ["loginId", "LoginId"]),
    userFullName: pickFirst(row, ["userFullName", "UserFullName", "name", "Name"]),
    email: pickFirst(row, ["email", "Email"]),
    isActive: pickFirst(row, ["isActive", "IsActive"]),
    ...row,
  }));
}
