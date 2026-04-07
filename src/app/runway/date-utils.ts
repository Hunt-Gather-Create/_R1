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
  return getMonday(date).toISOString().split("T")[0];
}
