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

  return Number.isInteger(normalized) &&
    normalized >= 200 &&
    normalized <= 599
    ? normalized
    : fallback;
}
