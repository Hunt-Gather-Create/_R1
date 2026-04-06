/**
 * Parse a YYYY-MM-DD string into a Date at noon local time.
 * Noon avoids DST edge cases that midnight parsing can hit.
 */
export function parseISODate(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00");
}

/**
 * Get the ISO date string (YYYY-MM-DD) of the Monday for a given date's week.
 */
export function getMondayISODate(date: Date): string {
  const day = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - day + (day === 0 ? -6 : 1));
  return monday.toISOString().split("T")[0];
}
