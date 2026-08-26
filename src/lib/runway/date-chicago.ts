/**
 * Chicago-timezone date helpers, shared by server reads and the client board.
 * Pure and dependency-free (Intl only, no drizzle/db/fs) so client components
 * can import it without pulling server code into the bundle. All Runway
 * "today" bucketing converges here (issue #43).
 */
export function chicagoISODate(date: Date): string {
  // en-CA formatter produces YYYY-MM-DD directly.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

/** The current Chicago day as YYYY-MM-DD. Clock injectable for tests. */
export function chicagoToday(now: Date = new Date()): string {
  return chicagoISODate(now);
}

/** The current Chicago day as a long display string, e.g. "Monday, April 20, 2026". */
export function chicagoDisplayDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
}
