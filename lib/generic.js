export function isInvalid(value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "number" && !Number.isFinite(value)) ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function normalizeHttpStatus(statusCode, fallback = 200) {
  const normalized = Number(statusCode);

  return Number.isInteger(normalized) && normalized >= 200 && normalized <= 599
    ? normalized
    : fallback;
}

export function isValidPositiveInteger(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0;
  }
  if (typeof value === "string") {
    return /^[1-9]\d*$/.test(value);
  }
  return false;
}

export function isValidUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
