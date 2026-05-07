import type { DayItem, DayItemEntry } from "./types";
import { parseISODate, getMondayISODate } from "./date-utils";

export interface WeekGroup {
  mondayDate: string;
  label: string;
  days: DayItem[];
}

/**
 * Merge adjacent Saturday/Sunday DayItems into a single "Weekend" column.
 * If only one of Sat/Sun exists, it passes through unchanged.
 */
export function mergeWeekendDays(days: DayItem[]): DayItem[] {
  const result: DayItem[] = [];
  let i = 0;
  while (i < days.length) {
    const d = parseISODate(days[i].date);
    const dayOfWeek = d.getDay();

    if (dayOfWeek === 6 && i + 1 < days.length) {
      const next = parseISODate(days[i + 1].date);
      if (next.getDay() === 0) {
        result.push({
          date: days[i].date,
          label: "Weekend",
          items: [...days[i].items, ...days[i + 1].items],
        });
        i += 2;
        continue;
      }
    }
    result.push(days[i]);
    i++;
  }
  return result;
}

/**
 * Group days by their week's Monday, producing a "w/o M/D" label for each group.
 */
export function groupByWeek(days: DayItem[]): WeekGroup[] {
  const groups: Map<string, DayItem[]> = new Map();
  for (const day of days) {
    const monday = getMondayISODate(parseISODate(day.date));
    const existing = groups.get(monday);
    if (existing) {
      existing.push(day);
    } else {
      groups.set(monday, [day]);
    }
  }
  return Array.from(groups.entries()).map(([monday, weekDays]) => {
    const d = parseISODate(monday);
    return {
      mondayDate: monday,
      label: `w/o ${d.getMonth() + 1}/${d.getDate()}`,
      days: weekDays,
    };
  });
}

// Terminal statuses -- rows in these states are excluded from the active-span
// filter (they're not "actively spanning" if done/canceled).
const TERMINAL_STATUSES = new Set(["completed", "canceled"]);

/**
 * Returns true if this weekItem is actively spanning today -- i.e. it has
 * started and not yet ended, and is not in a terminal status.
 *
 * Placement rule (dashboard-cleanup item 4): once startDate <= today, the
 * item belongs in the Today / In Flight zones, not in a day-cell column.
 *
 * Multi-day rows with startDate > today still appear in their startDate
 * day cell (forecast visibility).
 */
export function isActivelySpanning(item: DayItemEntry, todayISO: string): boolean {
  const start = item.startDate;
  const end = item.endDate;
  if (!start || !end) return false;
  if (start === end) return false; // single-day item
  if (item.status && TERMINAL_STATUSES.has(item.status)) return false;
  return start <= todayISO && todayISO <= end;
}

/**
 * Filter a DayItem array to remove actively-spanning rows from each day's
 * items. This prevents multi-day rows from appearing in BOTH the This Week
 * day-cell columns AND the Today / In Flight zones simultaneously.
 *
 * Rows with startDate > today pass through unchanged (forecast anchor).
 * Single-day rows pass through unchanged.
 * Terminal rows pass through unchanged.
 */
export function filterSpanningFromDayCells(days: DayItem[], todayISO: string): DayItem[] {
  return days.map((day) => {
    const filteredItems = day.items.filter((item) => !isActivelySpanning(item, todayISO));
    if (filteredItems.length === day.items.length) return day; // no change
    return { ...day, items: filteredItems };
  });
}
