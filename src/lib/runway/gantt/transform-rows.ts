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
  MonthBand,
  ProjectRow,
  RawData,
  WeekItemRow,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Operator-locked 2026-05-05 axis rework: three adaptive density tiers.
// Pre-rework: weekly mode emitted Mon-Fri 5-cells-per-week which crashed
// at 4+ month spans (Hopkins Research, Know Your Neighbor, HDL Website).
// Post-rework: density adapts to span so labels never collide.
const DAILY_MAX_DAYS = 14;       // ≤ 14 days → one column per day, M/D every day
const WEEKLY_MAX_DAYS = 56;      // 15-56 days (~2-8 weeks) → one column per Monday
                                 // > 56 days → monthly tier (sparse 6-10 ticks)

// Sparse-tick targets for the monthly tier — calibrated to keep labels
// readable at the chart widths that crashed in operator screenshots.
const MONTHLY_TARGET_TICKS_MIN = 6;
const MONTHLY_TARGET_TICKS_MAX = 10;

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

function formatNumericMD(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

const FULL_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function fullMonthName(d: Date): string {
  return FULL_MONTH_NAMES[d.getUTCMonth()];
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

/**
 * Group columns into contiguous month bands. Operator-locked 2026-05-05:
 * each band is the calendar month name (no year) — `April`, `May`, etc.
 * Bands are exhaustive and non-overlapping over the columns array.
 */
function buildMonthBands(columns: AxisColumn[]): MonthBand[] {
  if (columns.length === 0) return [];
  const bands: MonthBand[] = [];
  let curStart = 0;
  let curLabel = fullMonthName(parseISO(columns[0].date));
  for (let i = 1; i < columns.length; i++) {
    const label = fullMonthName(parseISO(columns[i].date));
    if (label !== curLabel) {
      bands.push({ startCol: curStart, endCol: i - 1, label: curLabel });
      curStart = i;
      curLabel = label;
    }
  }
  bands.push({
    startCol: curStart,
    endCol: columns.length - 1,
    label: curLabel,
  });
  return bands;
}

/**
 * Daily tier: every day from start through end (exclusive).
 */
function buildDailyColumns(start: Date, end: Date): AxisColumn[] {
  const out: AxisColumn[] = [];
  for (
    let cur = new Date(start);
    cur < end;
    cur = new Date(cur.getTime() + MS_PER_DAY)
  ) {
    out.push({ date: toISO(cur), label: formatNumericMD(cur) });
  }
  return out;
}

/**
 * Weekly tier: one column per Monday from start through end (exclusive).
 */
function buildWeeklyColumns(start: Date, end: Date): AxisColumn[] {
  const out: AxisColumn[] = [];
  for (let cur = new Date(start); cur < end; cur = addWeeks(cur, 1)) {
    out.push({ date: toISO(cur), label: formatNumericMD(cur) });
  }
  return out;
}

/**
 * Monthly tier: pick whichever of {every-other Monday, 1st-of-month} gives
 * a tick count in the [MIN, MAX] window. Falls back to every-Nth-Monday at
 * progressively wider strides if both candidates miss the window. The goal
 * is to keep labels visually readable at chart widths that crashed when
 * weekly Mon-Fri ticks ran for ~4 months.
 */
function buildMonthlyColumns(start: Date, end: Date): AxisColumn[] {
  // Candidate A: every-other Monday from `start`.
  const everyOtherMonday: AxisColumn[] = [];
  for (let cur = new Date(start); cur < end; cur = addWeeks(cur, 2)) {
    everyOtherMonday.push({ date: toISO(cur), label: formatNumericMD(cur) });
  }

  // Candidate B: first-of-month from `start` through `end`.
  const firstOfMonth: AxisColumn[] = [];
  for (
    let cur = startOfMonth(start);
    cur < end;
    cur = addMonths(cur, 1)
  ) {
    if (cur >= start) {
      firstOfMonth.push({ date: toISO(cur), label: formatNumericMD(cur) });
    }
  }

  // Pick the candidate that lands in the [MIN, MAX] window. If both
  // qualify, prefer every-other-Monday (slightly denser, matches Teamwork
  // aesthetic the operator referenced). If neither qualifies, walk wider
  // strides of Mondays until we land in the window.
  const inWindow = (n: number): boolean =>
    n >= MONTHLY_TARGET_TICKS_MIN && n <= MONTHLY_TARGET_TICKS_MAX;

  if (inWindow(everyOtherMonday.length)) return everyOtherMonday;
  if (inWindow(firstOfMonth.length)) return firstOfMonth;

  // Both candidates outside the window. Pick whichever overshoots less,
  // then thin to taste. If everyOtherMonday is too dense (long span),
  // try every-3rd, every-4th… Mondays.
  if (everyOtherMonday.length > MONTHLY_TARGET_TICKS_MAX) {
    for (let stride = 3; stride <= 12; stride++) {
      const thinned: AxisColumn[] = [];
      for (let cur = new Date(start); cur < end; cur = addWeeks(cur, stride)) {
        thinned.push({ date: toISO(cur), label: formatNumericMD(cur) });
      }
      if (inWindow(thinned.length) || thinned.length <= MONTHLY_TARGET_TICKS_MAX) {
        return thinned;
      }
    }
  }

  // Fallback: pick whichever candidate is closest to the [MIN, MAX] window.
  // Prefer firstOfMonth here (calendar-aligned reads cleaner for very long
  // spans). For very short windows where both are sparse, fall through to
  // everyOtherMonday so something renders.
  if (firstOfMonth.length >= MONTHLY_TARGET_TICKS_MIN) return firstOfMonth;
  return everyOtherMonday.length > 0 ? everyOtherMonday : firstOfMonth;
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
  const spanDays = Math.round(
    (maxDate.getTime() - minDate.getTime()) / MS_PER_DAY,
  );

  // Tier 1 — daily (≤ 14 days). One column per day across the full span,
  // aligned to the containing Monday so the start of week reads cleanly.
  if (spanDays <= DAILY_MAX_DAYS) {
    const start = startOfWeekMonday(minDate);
    const end = addWeeks(startOfWeekMonday(maxDate), 1);
    const columns = buildDailyColumns(start, end);
    const monthBands = buildMonthBands(columns);
    return {
      kind: "daily",
      start: toISO(start),
      end: toISO(end),
      today: todayISO,
      columns,
      monthBands,
    };
  }

  // Tier 2 — weekly (15-56 days). One column per Monday only — drops the
  // pre-rework Mon-Fri 5-cells-per-week pattern.
  if (spanDays <= WEEKLY_MAX_DAYS) {
    const start = startOfWeekMonday(minDate);
    const end = addWeeks(startOfWeekMonday(maxDate), 1);
    const columns = buildWeeklyColumns(start, end);
    const monthBands = buildMonthBands(columns);
    return {
      kind: "weekly",
      start: toISO(start),
      end: toISO(end),
      today: todayISO,
      columns,
      monthBands,
    };
  }

  // Tier 3 — monthly (> 56 days). Sparse 6-10 ticks chosen by buildMonthlyColumns.
  // Range is month-aligned for clean band labels.
  const start = startOfMonth(minDate);
  const end = addMonths(startOfMonth(maxDate), 1);
  const columns = buildMonthlyColumns(start, end);
  const monthBands = buildMonthBands(columns);
  return {
    kind: "monthly",
    start: toISO(start),
    end: toISO(end),
    today: todayISO,
    columns,
    monthBands,
  };
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
