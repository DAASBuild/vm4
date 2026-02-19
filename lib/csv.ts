/**
 * CSV generation utilities with safe escaping.
 */

function escapeCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  // If contains comma, quote, or newline — wrap in quotes and escape inner quotes
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCSV(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const cols = columns ?? Object.keys(rows[0]);
  const header = cols.map(escapeCell).join(',');
  const lines = rows.map((row) => cols.map((c) => escapeCell(row[c])).join(','));
  return [header, ...lines].join('\r\n');
}
