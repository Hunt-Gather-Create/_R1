/**
 * Pure section-builder helpers for the Runway Gantt rundown pipeline.
 *
 * These are the testable, DB-free exports extracted from
 * scripts/lib/gantt/rundown.ts. The async DB-coupled wrapper
 * (extractClientRundown) remains in scripts/lib/gantt/rundown.ts and imports
 * these helpers via a relative path back into src/.
 */

import {
  detectL1Issues,
  detectWeekItemIssues,
  detectWrapperIssues,
} from "./detect-issues";
import { computeAxis, formatDateRange, transformRows } from "./transform-rows";
import { summarize } from "./counter";
import type {
  AnnotatedRow,
  ClientRow,
  GanttData,
  GanttRow,
  Issue,
  ProjectRow,
  RawData,
  SeverityCounts,
  WeekItemRow,
} from "./types";

/**
 * Build a single-section GanttData for a project entity. Used both for
 * standalone L1s and for drilling into a wrapper-child. `extraChartIssues`
 * lets the wrapper-child path append its relational issues (parent-date
 * mismatch etc.) on the child's own section instead of the rollup.
 */
export function buildL1SectionData(
  entity: ProjectRow,
  client: ClientRow,
  weekItemsForEntity: WeekItemRow[],
  todayISO: string,
  generatedAt: string,
  extraChartIssues: Issue[] = [],
): GanttData {
  const raw: RawData = { kind: "l1", entity, client, children: weekItemsForEntity };
  const rows = transformRows(raw);
  const axis = computeAxis(raw, rows, new Date(`${todayISO}T00:00:00Z`));
  const itemById = new Map(weekItemsForEntity.map((w) => [w.id, w]));
  const annotated: AnnotatedRow[] = rows.map((row) => {
    if (row.kind !== "weekitem") return { ...row, inline: [], subRow: [] };
    const item = itemById.get(row.id);
    if (!item) return { ...row, inline: [], subRow: [] };
    return { ...row, ...detectWeekItemIssues(item, entity, todayISO) };
  });
  const chartIssues = [
    ...detectL1Issues(entity, weekItemsForEntity.length),
    ...extraChartIssues,
  ];
  const headerRange = formatDateRange(entity.startDate, entity.endDate);
  return {
    raw,
    rows: annotated,
    chartIssues,
    axis,
    headerRange,
    generatedAt,
    summary: summarize({ rows: annotated, chartIssues, entity }),
  };
}

/**
 * Wrapper rollup section — chart issues are wrapper-level only. Rows show
 * the children L1s as visual Gantt rows but with NO per-row inline or
 * sub-row alerts (those move to each child's drill-in section).
 */
export function buildWrapperSectionData(
  wrapper: ProjectRow,
  client: ClientRow,
  childProjects: ProjectRow[],
  orphanWeekItems: { id: string; title: string }[],
  generatedAt: string,
  todayISO: string,
): GanttData {
  const raw: RawData = {
    kind: "wrapper",
    entity: wrapper,
    client,
    children: childProjects,
    orphanWeekItems,
  };
  const baseRows: GanttRow[] = transformRows(raw);
  const axis = computeAxis(raw, baseRows, new Date(`${todayISO}T00:00:00Z`));
  // Suppress per-row alerts on the rollup — operator-locked.
  const annotated: AnnotatedRow[] = baseRows.map((row) => ({
    ...row,
    inline: [],
    subRow: [],
  }));
  const chartIssues = detectWrapperIssues(wrapper, childProjects, orphanWeekItems);
  const headerRange = formatDateRange(wrapper.startDate, wrapper.endDate);
  return {
    raw,
    rows: annotated,
    chartIssues,
    axis,
    headerRange,
    generatedAt,
    summary: summarize({ rows: annotated, chartIssues, entity: wrapper }),
  };
}

export function slugAnchor(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function addSeverity(target: SeverityCounts, src: SeverityCounts): void {
  target.critical += src.critical;
  target.warn += src.warn;
  target.info += src.info;
}
