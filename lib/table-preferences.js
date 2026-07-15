export const TABLE_PREFERENCE_PAGE_KEYS = {
  INTERACTIONS: "dashboard_interactions",
  EVALUATIONS: "dashboard_evaluations",
  USERS: "dashboard_users",
};

export function normalizeSavedColumnOrder(savedOrder, availableColumnIds = []) {
  if (!Array.isArray(availableColumnIds) || availableColumnIds.length === 0) {
    return [];
  }

  const safeSavedOrder = Array.isArray(savedOrder) ? savedOrder : [];

  return [
    ...safeSavedOrder.filter((id) => availableColumnIds.includes(id)),
    ...availableColumnIds.filter((id) => !safeSavedOrder.includes(id)),
  ];
}

export function normalizeSavedColumnVisibility(
  savedVisibility,
  availableColumnIds = [],
  defaultVisibilityResolver = () => true,
) {
  const normalized = {};
  const safeVisibility =
    savedVisibility && typeof savedVisibility === "object" ? savedVisibility : {};

  availableColumnIds.forEach((columnId) => {
    if (Object.prototype.hasOwnProperty.call(safeVisibility, columnId)) {
      normalized[columnId] = Boolean(safeVisibility[columnId]);
    } else {
      normalized[columnId] = Boolean(defaultVisibilityResolver(columnId));
    }
  });

  return normalized;
}
