export async function setUsersLoginModel(recordset = [], recordsets = []) {
  const userRecord = recordsets?.[0]?.[0] || recordset?.[0];
  if (!userRecord) {
    return [];
  }

  const roles = (recordsets?.[1] || []).map((role) => ({
    roleId: role.roleId ?? role.user_role_id ?? null,
    roleName: role.roleName ?? role.user_role ?? null,
  }));

  const organization = (recordsets?.[2] || []).map((item) => ({
    orgId: item.orgId ?? null,
    orgName: item.orgName ?? null,
  }));

  return [
    {
      userId: userRecord.userId ?? userRecord.userid ?? null,
      loginId: userRecord.loginId ?? userRecord.user_login_id ?? null,
      email: userRecord.email ?? null,
      userFullName:
        userRecord.userFullName ?? userRecord.user_full_name ?? null,
      phone: userRecord.phone ?? null,
      userRoles: roles,
      organization,
    },
  ];
}
