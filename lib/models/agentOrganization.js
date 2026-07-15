import { mapRows, pickFirst } from "@/lib/models/_shared";

export function setAgentOrganizationModule(rows) {
  return mapRows(rows, (row) => ({
    id: pickFirst(row, ["id", "Id", "ID"]),
    agentId: pickFirst(row, ["agentId", "AgentId"]),
    agentName: pickFirst(row, ["agentName", "AgentName"]),
    organizationId: pickFirst(row, ["organizationId", "OrganizationId", "orgId"]),
    organizationName: pickFirst(row, ["organizationName", "OrganizationName", "org_name"]),
    isActive: pickFirst(row, ["isActive", "IsActive"], true),
    ...row,
  }));
}
