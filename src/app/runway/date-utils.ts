/**
 * Parse a YYYY-MM-DD string into a Date at noon local time.
 * Noon avoids DST edge cases that midnight parsing can hit.
 */
export function parseISODate(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00");
}

/**
 * Get the Monday Date object for a given date's week.
 * Sunday is treated as part of the previous week.
 */
export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Get the ISO date string (YYYY-MM-DD) of the Monday for a given date's week.
 */
export function getMondayISODate(date: Date): string {
  return toISODateString(getMonday(date));
}

/**
 * Format a Date as a local ISO date string (YYYY-MM-DD).
 * Uses local time, not UTC, to avoid timezone shifts.
 */
export function toISODateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Format a YYYY-MM-DD ISO date string as "M/D" with no zero-padding and no
 * year. Returns null for null/undefined input or any string that doesn't
 * parse to a numeric month and day.
 */
export function toShortDateString(iso?: string | null): string | null {
  if (!iso) return null;
  const parts = iso.split("-");
  if (parts.length < 3) return null;
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (Number.isNaN(m) || Number.isNaN(d)) return null;
  return `${m}/${d}`;
}
