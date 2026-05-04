/**
 * Row transformation + time-axis computation.
 *
 * Pure functions only — no DB, no Date.now() unless explicitly passed.
 *
 *   transformRows(raw)        : RawData → GanttRow[] (sorted, nulls last)
 *   computeAxis(raw, rows, today): rows + entity dates → AxisParams
 *   formatDateRange(start, end): ISO pair → "4/17 – 5/11" / "null – null" / "4/17"
 */

import type {
  AxisColumn,
  AxisParams,
  GanttRow,
  ProjectRow,
  RawData,
  WeekItemRow,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const WEEK_THRESHOLD = 16; // span < 16 weeks → daily columns; else monthly

// ── Row mapping + sort ────────────────────────────────────

function projectToRow(p: ProjectRow): GanttRow {
  return {
    kind: "project",
    id: p.id,
    title: p.name,
    owner: p.owner,
    resources: p.resources,
    startDate: p.startDate,
    endDate: p.endDate,
    status: p.status,
    category: p.category,
    engagementType: p.engagementType,
    parentProjectId: p.parentProjectId,
    contractStart: p.contractStart,
    contractEnd: p.contractEnd,
    dueDate: p.dueDate,
    waitingOn: p.waitingOn,
  };
}

function weekItemToRow(w: WeekItemRow): GanttRow {
  return {
    kind: "weekitem",
    id: w.id,
    title: w.title,
    owner: w.owner,
    resources: w.resources,
    startDate: w.startDate,
    endDate: w.endDate,
    status: w.status,
    category: w.category,
    weekOf: w.weekOf,
  };
}

function compareByStart(a: GanttRow, b: GanttRow): number {
  if (a.startDate === b.startDate) return 0;
  if (a.startDate === null) return 1; // nulls last
  if (b.startDate === null) return -1;
  return a.startDate < b.startDate ? -1 : 1;
}

export function transformRows(raw: RawData): GanttRow[] {
  const mapped =
    raw.kind === "wrapper"
      ? raw.children.map(projectToRow)
      : raw.children.map(weekItemToRow);
  return [...mapped].sort(compareByStart);
}

// ── Date utilities (UTC-based to avoid TZ drift) ─────────

function parseISO(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun ... 6=Sat
  const diff = day === 0 ? 6 : day - 1;
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() - diff);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addWeeks(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n * 7);
  return r;
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function formatWeekLabel(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// Short weekday labels for non-Monday daily axis ticks
const WEEKDAY_SHORT = ["Su", "M", "T", "W", "Th", "F", "Sa"] as const;

function formatDailyLabel(d: Date): string {
  const dow = d.getUTCDay(); // 0=Sun
  if (dow === 1) {
    // Monday: full numeric date "M/D"
    return formatWeekLabel(d);
  }
  return WEEKDAY_SHORT[dow];
}

function formatMonthLabel(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
}

// ── Axis computation ──────────────────────────────────────

function collectNonNullDates(raw: RawData, rows: GanttRow[]): string[] {
  const out: string[] = [];
  if (raw.entity.startDate) out.push(raw.entity.startDate);
  if (raw.entity.endDate) out.push(raw.entity.endDate);
  for (const row of rows) {
    if (row.startDate) out.push(row.startDate);
    if (row.endDate) out.push(row.endDate);
  }
  return out;
}

export function computeAxis(
  raw: RawData,
  rows: GanttRow[],
  today: Date = new Date(),
): AxisParams {
  const todayISO = toISO(today);
  const dates = collectNonNullDates(raw, rows);
  if (dates.length === 0) return { kind: "no-axis", today: todayISO };

  // ISO YYYY-MM-DD strings sort lexicographically as dates.
  const min = dates.reduce((a, b) => (a < b ? a : b));
  const max = dates.reduce((a, b) => (a > b ? a : b));
  const minDate = parseISO(min);
  const maxDate = parseISO(max);
  const spanWeeks = (maxDate.getTime() - minDate.getTime()) / MS_PER_WEEK;

  if (spanWeeks < WEEK_THRESHOLD) {
    const start = startOfWeekMonday(minDate);
    const end = addWeeks(startOfWeekMonday(maxDate), 1);
    const columns: AxisColumn[] = [];
    // Emit one column PER DAY (excluding weekends) across the span.
    // Operator (2026-04-30): daily ticks pulled forward from fast-follow.
    // Monday ticks get a full "M/D" label; other weekdays get an abbreviated
    // letter label (T, W, Th, F). Saturdays and Sundays are omitted.
    // At narrow container widths, CSS container queries hide non-Monday ticks
    // (data-day attr drives the selectors) — the existing rules still fire.
    for (
      let cur = new Date(start);
      cur < end;
      cur = new Date(cur.getTime() + MS_PER_DAY)
    ) {
      const dow = cur.getUTCDay();
      if (dow === 0 || dow === 6) continue; // skip weekends
      columns.push({ date: toISO(cur), label: formatDailyLabel(cur) });
    }
    return { kind: "weekly", start: toISO(start), end: toISO(end), today: todayISO, columns };
  }

  const start = startOfMonth(minDate);
  const end = addMonths(startOfMonth(maxDate), 1);
  const columns: AxisColumn[] = [];
  for (let cur = new Date(start); cur < end; cur = addMonths(cur, 1)) {
    columns.push({ date: toISO(cur), label: formatMonthLabel(cur) });
  }
  return { kind: "monthly", start: toISO(start), end: toISO(end), today: todayISO, columns };
}

// ── Date display ──────────────────────────────────────────

function formatNumeric(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

/**
 * Format an inclusive date pair for display in the chart header AND in row
 * inline date fields. Operator-locked format: numeric `M/D`, no zero-pad,
 * no year, en-dash separator (U+2013). Both null → literal "null – null"
 * so the gap is visible.
 */
export function formatDateRange(start: string | null, end: string | null): string {
  if (start === null && end === null) return "null – null";
  if (start === null) return `null – ${formatNumeric(end!)}`;
  if (end === null) return `${formatNumeric(start)} – null`;
  if (start === end) return formatNumeric(start);
  return `${formatNumeric(start)} – ${formatNumeric(end)}`;
}
