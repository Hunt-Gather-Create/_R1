/**
 * Deterministic data-quality detectors for the Gantt CLI.
 *
 * Pure functions. No DB, no I/O, no LLM. Each detector returns the issues
 * for one scope:
 *
 *   detectL1Issues(entity, weekItemCount)            → chart-level L1 alerts
 *   detectWrapperIssues(wrapper, children, orphans)  → chart-level wrapper alerts
 *   detectChildProjectIssues(child, wrapper)         → wrapper-view row issues
 *   detectWeekItemIssues(item, parent, todayISO)     → L1-view row issues
 *   detectAllIssues(raw, rows, today)                → top-level dispatcher
 *
 * Row issues are split into `inline` (shown on the row itself, e.g. red
 * `null – null`) and `subRow` (shown as an alert sub-row beneath the row).
 *
 * Severity is assigned per-code via the SEVERITY map below. The full
 * taxonomy:
 *   critical — data is invalid or actively misleading (broken refs,
 *              wrong-typed values, contradictions, end<start, stored "")
 *   warn     — gap that needs filling but the field's value is plausibly
 *              null-by-default (no contract, no owner, missing dates)
 *   info     — soft convention violation (e.g. resource role-prefix)
 */

import type {
  AnnotatedRow,
  GanttRow,
  Issue,
  IssueCode,
  ProjectRow,
  RawData,
  RowIssues,
  Severity,
  WeekItemRow,
} from "./types";

// ── Operator-confirmed enum lists ─────────────────────────

const VALID_ENGAGEMENT_TYPES = new Set(["retainer", "project"]);
const ACTIVE_WI_STATUSES = new Set(["in-progress", "scheduled", "at-risk"]);
const TERMINAL_WI_STATUSES = new Set(["completed", "canceled"]);
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// ── Severity map ──────────────────────────────────────────
// Single source of truth. Anything not listed here defaults to "warn".

const SEVERITY: Record<IssueCode, Severity> = {
  // L1 chart
  "l1-null-dates": "warn",
  "l1-retainer-null-contract": "warn",
  "l1-null-engagement-type": "warn",
  "l1-bad-engagement-type": "critical",
  "l1-null-category-or-status": "warn",
  "l1-awaiting-null-waiting-on": "warn",
  "l1-due-end-mismatch": "critical",
  "l1-empty-string-due-date": "critical",
  "l1-no-weekitems-no-owner": "warn",
  // Wrapper chart
  "wrapper-null-contract": "warn",
  "wrapper-no-children": "critical",
  "wrapper-null-dates": "critical",
  "wrapper-range-misses-children": "warn",
  "wrapper-bad-engagement-type": "critical",
  "wrapper-child-contract-mismatch": "critical",
  "wrapper-has-orphan-weekitems": "critical",
  // Wrapper-view row (project)
  "row-both-dates-null": "warn",
  "row-only-start-null": "warn",
  "row-only-end-null": "warn",
  "row-end-before-start": "critical",
  "child-active-null-owner": "warn",
  "child-orphan": "critical",
  "child-parent-date-mismatch": "critical",
  "child-end-before-start": "critical",
  "child-status-category-mismatch": "warn",
  "child-awaiting-null-waiting-on": "warn",
  "child-null-engagement-when-parent-set": "warn",
  // L1-view row (weekitem)
  "wi-both-dates-null": "warn",
  "wi-only-start-null": "warn",
  "wi-only-end-null": "warn",
  "wi-end-before-start": "critical",
  "wi-active-null-owner": "warn",
  "wi-overdue": "warn",
  "wi-outside-parent-range": "critical",
  "wi-day-of-week-mismatch": "warn",
  "wi-week-of-stale": "warn",
  "wi-empty-string-status": "critical",
  "wi-empty-string-resources": "critical",
  "wi-bare-resource-name": "info",
};

function issue(code: IssueCode, message: string): Issue {
  return { code, message, severity: SEVERITY[code] };
}

function isBlank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v === "";
}

function isEmptyString(v: string | null | undefined): boolean {
  return v === "";
}

// ── Date math for dayOfWeek + weekOf checks ──────────────

function parseISODate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Lowercase day name for an ISO date string, or null if unparseable. */
function dayName(iso: string): string | null {
  const d = parseISODate(iso);
  if (!d) return null;
  return DAY_NAMES[d.getUTCDay()];
}

/** ISO date of the Monday of `iso`'s week (UTC). */
function mondayOf(iso: string): string | null {
  const d = parseISODate(iso);
  if (!d) return null;
  const dow = d.getUTCDay(); // 0=Sun ... 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow; // Sun → -6, Mon → 0, Tue → -1, ...
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ── Resource role-prefix convention ──────────────────────
// Per memory: roles AM/CD/Dev/CW/PM/CM/Strat. Pattern: "Role: Name" per
// comma-separated segment. Bare names violate. We accept any 1-6 char
// alpha role token before a colon to stay forgiving.

const ROLE_SEGMENT = /^\s*[A-Za-z]{1,6}:\s+\S/;

function hasBareName(resources: string): boolean {
  // "(client)" suffix and parentheses around role hints are tolerated; we
  // only flag if a segment lacks the leading "Role:" prefix. Skip empty
  // segments entirely (trailing comma is benign).
  const segments = resources.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.some((seg) => !ROLE_SEGMENT.test(seg));
}

// ── Inline date issues (shared between project + weekItem rows) ──

function detectInlineDates(
  startDate: string | null,
  endDate: string | null,
  prefix: "row" | "wi",
): Issue[] {
  if (startDate === null && endDate === null) {
    return [issue(`${prefix}-both-dates-null` as IssueCode, "Both start and end dates are null.")];
  }
  if (startDate === null) {
    return [issue(`${prefix}-only-start-null` as IssueCode, "Start date is null.")];
  }
  if (endDate === null) {
    return [issue(`${prefix}-only-end-null` as IssueCode, "End date is null.")];
  }
  if (endDate < startDate) {
    return [
      issue(
        `${prefix}-end-before-start` as IssueCode,
        `End date (${endDate}) is before start date (${startDate}).`,
      ),
    ];
  }
  return [];
}

// ── Per-row detectors ────────────────────────────────────

export function detectChildProjectIssues(
  child: ProjectRow,
  wrapper: ProjectRow,
): RowIssues {
  const inline = detectInlineDates(child.startDate, child.endDate, "row");
  const subRow: Issue[] = [];

  if (child.category === "active" && isBlank(child.owner)) {
    subRow.push(issue("child-active-null-owner", "Active project has no owner."));
  }

  if (child.parentProjectId === null) {
    subRow.push(
      issue(
        "child-orphan",
        "Child project has parentProjectId=null (expected to point at the wrapper).",
      ),
    );
  }

  // Parent-child date mismatch — wrapper range derived from entity start/end OR contract dates.
  const wrapperStart = wrapper.startDate ?? wrapper.contractStart;
  const wrapperEnd = wrapper.endDate ?? wrapper.contractEnd;
  if (wrapperStart && wrapperEnd) {
    if (
      (child.startDate && child.startDate < wrapperStart) ||
      (child.endDate && child.endDate > wrapperEnd)
    ) {
      subRow.push(
        issue(
          "child-parent-date-mismatch",
          `Child range (${child.startDate ?? "null"} – ${child.endDate ?? "null"}) outside wrapper range (${wrapperStart} – ${wrapperEnd}).`,
        ),
      );
    }
  }

  if (child.startDate && child.endDate && child.endDate < child.startDate) {
    subRow.push(
      issue(
        "child-end-before-start",
        `End (${child.endDate}) is before start (${child.startDate}).`,
      ),
    );
  }

  // child-status-category-mismatch — terminal/paused status paired with
  // category="active", or category="completed" paired with non-completed
  // status. `awaiting-client` is intentionally NOT flagged because work
  // there is still in flight (just blocked on the client).
  const TERMINAL_OR_PAUSED = new Set(["completed", "canceled", "on-hold"]);
  if (child.category === "active" && child.status && TERMINAL_OR_PAUSED.has(child.status)) {
    subRow.push(
      issue(
        "child-status-category-mismatch",
        `Status '${child.status}' but category 'active'.`,
      ),
    );
  } else if (child.category === "completed" && child.status && child.status !== "completed") {
    subRow.push(
      issue(
        "child-status-category-mismatch",
        `Category 'completed' but status '${child.status}'.`,
      ),
    );
  }

  if (child.status === "awaiting-client" && isBlank(child.waitingOn)) {
    subRow.push(
      issue("child-awaiting-null-waiting-on", "Status 'awaiting-client' but waitingOn is null."),
    );
  }

  if (wrapper.engagementType && isBlank(child.engagementType)) {
    subRow.push(
      issue(
        "child-null-engagement-when-parent-set",
        `Wrapper engagementType is '${wrapper.engagementType}' but child engagementType is null.`,
      ),
    );
  }

  return { inline, subRow };
}

export function detectWeekItemIssues(
  item: WeekItemRow,
  parent: ProjectRow,
  todayISO: string,
): RowIssues {
  const inline = detectInlineDates(item.startDate, item.endDate, "wi");
  const subRow: Issue[] = [];

  // Per operator: null status is treated as 'scheduled' for bucketing/filtering.
  // But empty-string status is itself a bug we want to surface, so we flag
  // it explicitly before normalizing.
  if (isEmptyString(item.status)) {
    subRow.push(
      issue(
        "wi-empty-string-status",
        "Status is empty string '' (should be null or a valid status).",
      ),
    );
  }
  const effectiveStatus = item.status ? item.status : "scheduled";

  if (ACTIVE_WI_STATUSES.has(effectiveStatus) && isBlank(item.owner)) {
    subRow.push(
      issue(
        "wi-active-null-owner",
        `Status '${effectiveStatus}' but owner is null.`,
      ),
    );
  }

  if (
    item.endDate &&
    item.endDate < todayISO &&
    !TERMINAL_WI_STATUSES.has(effectiveStatus)
  ) {
    subRow.push(
      issue(
        "wi-overdue",
        `End date (${item.endDate}) is in the past and status is '${effectiveStatus}'.`,
      ),
    );
  }

  // wi-outside-parent-range — only fires when parent has BOTH dates set.
  if (parent.startDate && parent.endDate) {
    const startsBefore = item.startDate && item.startDate < parent.startDate;
    const endsAfter = item.endDate && item.endDate > parent.endDate;
    if (startsBefore || endsAfter) {
      subRow.push(
        issue(
          "wi-outside-parent-range",
          `Item range (${item.startDate ?? "null"} – ${item.endDate ?? "null"}) outside parent project range (${parent.startDate} – ${parent.endDate}).`,
        ),
      );
    }
  }

  // Convention (docs/runway-data-integrity-intent.md lines 17-20):
  //   - `date` mirrors `endDate` on multi-day range tasks.
  //   - `dayOfWeek` tracks `date` (NOT startDate).
  //   - `weekOf` is the Monday of the week containing `date`.
  // For multi-day items, startDate ≠ date. Anchoring on startDate produces
  // false positives. If `date` is null we have no anchor — skip silently.
  if (item.dayOfWeek && item.date) {
    const expected = dayName(item.date);
    const got = item.dayOfWeek.toLowerCase().trim();
    if (expected && got !== expected) {
      subRow.push(
        issue(
          "wi-day-of-week-mismatch",
          `dayOfWeek '${item.dayOfWeek}' doesn't match date ${item.date} (${expected}).`,
        ),
      );
    }
  }

  if (item.weekOf && item.date) {
    const expected = mondayOf(item.date);
    if (expected && item.weekOf !== expected) {
      subRow.push(
        issue(
          "wi-week-of-stale",
          `weekOf '${item.weekOf}' isn't Monday-of-week for date ${item.date} (expected ${expected}).`,
        ),
      );
    }
  }

  if (isEmptyString(item.resources)) {
    subRow.push(
      issue(
        "wi-empty-string-resources",
        "Resources is empty string '' (should be null or a populated value).",
      ),
    );
  } else if (item.resources && hasBareName(item.resources)) {
    subRow.push(
      issue(
        "wi-bare-resource-name",
        `Resources '${item.resources}' has a segment without a 'Role:' prefix.`,
      ),
    );
  }

  return { inline, subRow };
}

// ── Chart-level detectors ─────────────────────────────────

export function detectL1Issues(entity: ProjectRow, weekItemCount: number): Issue[] {
  const issues: Issue[] = [];

  if (entity.startDate === null || entity.endDate === null) {
    const which =
      entity.startDate === null && entity.endDate === null
        ? "startDate and endDate"
        : entity.startDate === null
          ? "startDate"
          : "endDate";
    issues.push(issue("l1-null-dates", `Project has null ${which}.`));
  }

  if (entity.engagementType === "retainer") {
    if (isBlank(entity.contractStart) || isBlank(entity.contractEnd)) {
      issues.push(
        issue("l1-retainer-null-contract", "Retainer has null contractStart or contractEnd."),
      );
    }
  }

  // Split null vs invalid: null is a fillable gap (warn); invalid is a
  // schema violation (critical, e.g. "break-fix" lingering after validator
  // tightening).
  if (isBlank(entity.engagementType)) {
    issues.push(issue("l1-null-engagement-type", "engagementType is null."));
  } else if (!VALID_ENGAGEMENT_TYPES.has(entity.engagementType!)) {
    issues.push(
      issue(
        "l1-bad-engagement-type",
        `engagementType '${entity.engagementType}' is not in {retainer, project}.`,
      ),
    );
  }

  if (isBlank(entity.category) || isBlank(entity.status)) {
    const which =
      isBlank(entity.category) && isBlank(entity.status)
        ? "category and status"
        : isBlank(entity.category)
          ? "category"
          : "status";
    issues.push(issue("l1-null-category-or-status", `${which} is null.`));
  }

  if (entity.status === "awaiting-client" && isBlank(entity.waitingOn)) {
    issues.push(
      issue("l1-awaiting-null-waiting-on", "Status 'awaiting-client' but waitingOn is null."),
    );
  }

  if (isEmptyString(entity.dueDate)) {
    issues.push(
      issue(
        "l1-empty-string-due-date",
        "dueDate is empty string '' (should be null or an ISO date).",
      ),
    );
  }

  // l1-due-end-mismatch: both set but different.
  if (
    !isBlank(entity.dueDate) &&
    !isBlank(entity.endDate) &&
    entity.dueDate !== entity.endDate
  ) {
    issues.push(
      issue(
        "l1-due-end-mismatch",
        `dueDate (${entity.dueDate}) and endDate (${entity.endDate}) are both set but disagree.`,
      ),
    );
  }

  if (weekItemCount === 0 && isBlank(entity.owner)) {
    issues.push(
      issue("l1-no-weekitems-no-owner", "Project has no weekItems and no owner."),
    );
  }

  return issues;
}

export function detectWrapperIssues(
  wrapper: ProjectRow,
  children: ProjectRow[],
  orphanWeekItems: { id: string; title: string }[],
): Issue[] {
  const issues: Issue[] = [];

  if (isBlank(wrapper.contractStart) || isBlank(wrapper.contractEnd)) {
    issues.push(
      issue("wrapper-null-contract", "Wrapper has null contractStart or contractEnd."),
    );
  }

  if (children.length === 0) {
    issues.push(issue("wrapper-no-children", "Wrapper has no child projects."));
  }

  if (wrapper.engagementType !== "retainer") {
    issues.push(
      issue(
        "wrapper-bad-engagement-type",
        `Wrapper engagementType is '${wrapper.engagementType ?? "null"}', expected 'retainer'.`,
      ),
    );
  }

  // wrapper-null-dates — wrapper has children but its own startDate/endDate
  // is null. Per data TP: recompute won't fill because the guard pins
  // existing values; only override-with-bypass-flag fixes it.
  if (children.length > 0 && (isBlank(wrapper.startDate) || isBlank(wrapper.endDate))) {
    const which =
      isBlank(wrapper.startDate) && isBlank(wrapper.endDate)
        ? "startDate and endDate"
        : isBlank(wrapper.startDate)
          ? "startDate"
          : "endDate";
    issues.push(
      issue(
        "wrapper-null-dates",
        `Wrapper has children but ${which} is null. Recompute won't fill — needs override with bypassGuard.`,
      ),
    );
  }

  // wrapper-range-misses-children — fires only when the wrapper range is
  // SET (so range-vs-children comparison is meaningful). The null case is
  // covered by wrapper-null-dates above.
  const wrapperStart = wrapper.startDate ?? wrapper.contractStart;
  const wrapperEnd = wrapper.endDate ?? wrapper.contractEnd;
  if (wrapperStart && wrapperEnd) {
    const offending: string[] = [];
    for (const c of children) {
      if (c.startDate && c.startDate < wrapperStart) {
        offending.push(`${c.name} starts ${c.startDate}`);
      }
      if (c.endDate && c.endDate > wrapperEnd) {
        offending.push(`${c.name} ends ${c.endDate}`);
      }
    }
    if (offending.length > 0) {
      issues.push(
        issue(
          "wrapper-range-misses-children",
          `Wrapper range (${wrapperStart} – ${wrapperEnd}) doesn't cover: ${offending.join("; ")}.`,
        ),
      );
    }
  }

  if (!isBlank(wrapper.contractStart) && !isBlank(wrapper.contractEnd)) {
    const mismatched: string[] = [];
    for (const c of children) {
      if (!isBlank(c.contractStart) && c.contractStart !== wrapper.contractStart) {
        mismatched.push(`${c.name} contractStart ${c.contractStart}`);
      }
      if (!isBlank(c.contractEnd) && c.contractEnd !== wrapper.contractEnd) {
        mismatched.push(`${c.name} contractEnd ${c.contractEnd}`);
      }
    }
    if (mismatched.length > 0) {
      issues.push(
        issue(
          "wrapper-child-contract-mismatch",
          `Children with mismatched contract dates: ${mismatched.join("; ")}.`,
        ),
      );
    }
  }

  if (orphanWeekItems.length > 0) {
    const idList = orphanWeekItems.map((w) => `${w.id} (${w.title})`).join(", ");
    const noun = orphanWeekItems.length === 1 ? "weekItem" : "weekItems";
    issues.push(
      issue(
        "wrapper-has-orphan-weekitems",
        `Wrapper has ${orphanWeekItems.length} ${noun} attached directly — only child project rows are rendered. Move or delete: ${idList}`,
      ),
    );
  }

  return issues;
}

// ── Top-level dispatcher ──────────────────────────────────

export function detectAllIssues(
  raw: RawData,
  rows: GanttRow[],
  today: Date = new Date(),
): { rows: AnnotatedRow[]; chartIssues: Issue[] } {
  const todayISO = today.toISOString().slice(0, 10);

  if (raw.kind === "wrapper") {
    const chartIssues = detectWrapperIssues(raw.entity, raw.children, raw.orphanWeekItems);
    const childById = new Map(raw.children.map((c) => [c.id, c]));
    const annotated: AnnotatedRow[] = rows.map((row) => {
      if (row.kind !== "project") {
        return { ...row, inline: [], subRow: [] };
      }
      const child = childById.get(row.id);
      if (!child) return { ...row, inline: [], subRow: [] };
      const result = detectChildProjectIssues(child, raw.entity);
      return { ...row, ...result };
    });
    return { rows: annotated, chartIssues };
  }

  // L1 view
  const chartIssues = detectL1Issues(raw.entity, raw.children.length);
  const itemById = new Map(raw.children.map((c) => [c.id, c]));
  const annotated: AnnotatedRow[] = rows.map((row) => {
    if (row.kind !== "weekitem") {
      return { ...row, inline: [], subRow: [] };
    }
    const item = itemById.get(row.id);
    if (!item) return { ...row, inline: [], subRow: [] };
    const result = detectWeekItemIssues(item, raw.entity, todayISO);
    return { ...row, ...result };
  });
  return { rows: annotated, chartIssues };
}
