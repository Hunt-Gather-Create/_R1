/**
 * Shared types for the Runway Gantt CLI.
 *
 * Co-located with the gantt module under scripts/lib/gantt/.
 */

import type { projects, weekItems, clients } from "@/lib/db/runway-schema";

export type ProjectRow = typeof projects.$inferSelect;
export type WeekItemRow = typeof weekItems.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;

// ── Resolution ───────────────────────────────────────────

export type ResolvedSubject =
  | { kind: "wrapper"; project: ProjectRow; childProjects: ProjectRow[] }
  | { kind: "l1"; project: ProjectRow };

export type ResolveProjectResult =
  | { ok: true; subject: ResolvedSubject }
  | { ok: false; error: string; available?: string[] };

export type ResolveClientResult =
  | { ok: true; client: ClientRow; topLevelProjects: ProjectRow[] }
  | { ok: false; error: string; available?: string[] };

// ── Extracted data ───────────────────────────────────────

/**
 * The classified, query-ready dataset for one Gantt render. Discriminated by
 * which view applies: a wrapper renders child L1 projects (and surfaces any
 * weekItems attached directly to the wrapper as orphans); an L1 view renders
 * its own weekItems.
 */
export type RawData =
  | {
      kind: "wrapper";
      entity: ProjectRow;
      client: ClientRow;
      children: ProjectRow[];
      orphanWeekItems: { id: string; title: string }[];
    }
  | {
      kind: "l1";
      entity: ProjectRow;
      client: ClientRow;
      children: WeekItemRow[];
    };

// ── Transformed rows + axis ──────────────────────────────

export type GanttRow =
  | {
      kind: "project";
      id: string;
      title: string;
      owner: string | null;
      resources: string | null;
      startDate: string | null;
      endDate: string | null;
      status: string | null;
      category: string | null;
      engagementType: string | null;
      parentProjectId: string | null;
      contractStart: string | null;
      contractEnd: string | null;
      dueDate: string | null;
      waitingOn: string | null;
    }
  | {
      kind: "weekitem";
      id: string;
      title: string;
      owner: string | null;
      resources: string | null;
      startDate: string | null;
      endDate: string | null;
      status: string | null;
      category: string | null;
      weekOf: string | null;
    };

export type AxisColumn = { date: string; label: string };

/**
 * A contiguous run of axis columns belonging to the same calendar month.
 * Operator-locked 2026-05-05: axis renders TWO rows — month names spanning
 * the columns within each month (top), tick labels (bottom). `startCol` and
 * `endCol` are inclusive 0-based indexes into the `columns` array.
 *
 * `label` is the calendar month name only (no year) — e.g. "April", "May".
 */
export type MonthBand = {
  startCol: number; // inclusive index into columns
  endCol: number; // inclusive index into columns
  label: string; // calendar month name, no year (e.g. "April")
};

/**
 * Discriminator semantics post-2026-05-05 axis rework:
 *  - "daily"   = ≤ 14-day span: one column per day, M/D label every day
 *  - "weekly"  = 15–56-day span: one column per Monday, M/D label
 *  - "monthly" = > 56-day span (8+ weeks): adaptive sparse ticks (every-other
 *                Monday or 1st-of-month) chosen to keep total tick count in
 *                the 6–10 range so labels don't collide
 *  - "no-axis" = no usable dates anywhere in the dataset
 *
 * Both light themes and the dark-account-view embed use this same shape and
 * render two rows: month bands above the columns, tick labels at the columns.
 */
export type AxisParams =
  | { kind: "no-axis"; today: string }
  | {
      kind: "daily" | "weekly" | "monthly";
      start: string; // ISO date (column-aligned)
      end: string; // ISO date (exclusive — first date past the last column)
      today: string;
      columns: AxisColumn[];
      monthBands: MonthBand[];
    };

// ── Issues ───────────────────────────────────────────────

export type IssueCode =
  // Chart-level — L1 (subject is L1 or sub-project)
  | "l1-null-dates"
  | "l1-retainer-null-contract"
  | "l1-null-engagement-type"
  | "l1-bad-engagement-type"
  | "l1-null-category-or-status"
  | "l1-awaiting-null-waiting-on"
  | "l1-due-end-mismatch"
  | "l1-empty-string-due-date"
  | "l1-no-weekitems-no-owner"
  // Chart-level — Wrapper
  | "wrapper-null-contract"
  | "wrapper-no-children"
  | "wrapper-null-dates"
  | "wrapper-range-misses-children"
  | "wrapper-bad-engagement-type"
  | "wrapper-child-contract-mismatch"
  | "wrapper-has-orphan-weekitems"
  // Row-level — wrapper view rows (deliverable L1 projects)
  | "row-both-dates-null"
  | "row-only-start-null"
  | "row-only-end-null"
  | "row-end-before-start"
  | "child-active-null-owner"
  | "child-orphan"
  | "child-parent-date-mismatch"
  | "child-end-before-start"
  | "child-status-category-mismatch"
  | "child-awaiting-null-waiting-on"
  | "child-null-engagement-when-parent-set"
  // Row-level — L1 view rows (weekItems)
  | "wi-both-dates-null"
  | "wi-only-start-null"
  | "wi-only-end-null"
  | "wi-end-before-start"
  | "wi-active-null-owner"
  | "wi-overdue"
  | "wi-outside-parent-range"
  | "wi-day-of-week-mismatch"
  | "wi-week-of-stale"
  | "wi-empty-string-status"
  | "wi-empty-string-resources"
  | "wi-bare-resource-name";

export type Severity = "critical" | "warn" | "info";

export type Issue = { code: IssueCode; message: string; severity: Severity };

export type RowIssues = { inline: Issue[]; subRow: Issue[] };

export type AnnotatedRow = GanttRow & RowIssues;

// ── Summary + assembled chart data ───────────────────────

export type CodeRef = { id: string; title: string };

export type SeverityCounts = { critical: number; warn: number; info: number };

export type Summary = {
  rowsWithGaps: number; // rows where inline.length + subRow.length > 0
  totalRows: number;
  chartIssueCount: number;
  byCode: Record<string, CodeRef[]>; // keyed by IssueCode string
  codeSeverity: Record<string, Severity>; // code → severity, for panel grouping
  severity: SeverityCounts; // counts across chart + row issues
  childRollup?: ChildRollupEntry[]; // wrapper view only
  chartIssues: Issue[]; // mirrored here so the panel can render in full
};

export type ChildRollupEntry = {
  id: string;
  title: string;
  critical: number;
  warn: number;
  info: number;
};

export type GanttData = {
  raw: RawData;
  rows: AnnotatedRow[];
  chartIssues: Issue[];
  axis: AxisParams;
  headerRange: string; // formatted "4/17 – 5/11" / "null – null" / "5/11"
  generatedAt: string; // YYYY-MM-DD
  summary: Summary;
};

// ── Client rundown (single-page, multi-section) ───────────

export type RundownSectionKind = "wrapper" | "wrapper-child" | "standalone";

export type RundownSection = {
  anchor: string; // slug for the in-page #anchor jump
  kind: RundownSectionKind;
  title: string;
  parentTitle?: string; // for wrapper-child: the wrapper's name
  data: GanttData;
};

export type ClientRundownData = {
  client: ClientRow;
  sections: RundownSection[];
  generatedAt: string; // YYYY-MM-DD
  overallSeverity: SeverityCounts;
};

// ── Theme ─────────────────────────────────────────────────

export type Theme = "light-internal" | "light-branded" | "dark-account-view";
