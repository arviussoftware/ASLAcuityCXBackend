export function mapRows(rows, transform = (row) => row) {
  return Array.isArray(rows) ? rows.map(transform) : [];
}

export function pickFirst(row, keys, fallback = null) {
  for (const key of keys) {
    if (row && row[key] !== undefined) {
      return row[key];
    }
  }
  return fallback;
}
