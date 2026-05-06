/**
 * Counter — summarize chart-level + row-level issues into a severity
 * rollup, a counter line, and an itemized breakdown for the rendered
 * template.
 *
 *   summarize(input)              — Summary with severity bucket + child rollup
 *   formatCounterMarkup(summary)  — JSX block for the template's counter slot
 *   formatCounterConsole(s, path) — plain-text mirror for the CLI
 */

import * as React from "react";
import type { ReactNode } from "react";
import type {
  AnnotatedRow,
  ChildRollupEntry,
  Issue,
  ProjectRow,
  Severity,
  SeverityCounts,
  Summary,
} from "./types";

const ZERO_COUNTS: SeverityCounts = { critical: 0, warn: 0, info: 0 };

function bumpSeverity(target: SeverityCounts, severity: Severity): void {
  target[severity] += 1;
}

/**
 * Walk all issues (chart + row) and roll up:
 *   - rowsWithGaps    : rows with at least one inline OR subRow issue
 *   - totalRows       : data.rows.length
 *   - chartIssueCount : data.chartIssues.length
 *   - byCode          : code → list of affected entities
 *   - severity        : critical / warn / info totals
 *   - childRollup     : per-row severity counts (used by wrapper view)
 */
export function summarize(input: {
  rows: AnnotatedRow[];
  chartIssues: Issue[];
  entity: ProjectRow;
}): Summary {
  const { rows, chartIssues, entity } = input;
  const byCode: Record<string, { id: string; title: string }[]> = {};
  const codeSeverity: Record<string, Severity> = {};
  const severity: SeverityCounts = { ...ZERO_COUNTS };
  const childRollup: ChildRollupEntry[] = [];

  let rowsWithGaps = 0;
  for (const row of rows) {
    const rowSeverity: SeverityCounts = { ...ZERO_COUNTS };
    const all = [...row.inline, ...row.subRow];
    for (const i of all) {
      bumpSeverity(severity, i.severity);
      bumpSeverity(rowSeverity, i.severity);
      if (!byCode[i.code]) byCode[i.code] = [];
      byCode[i.code].push({ id: row.id, title: row.title });
      codeSeverity[i.code] = i.severity;
    }
    if (all.length > 0) rowsWithGaps += 1;
    childRollup.push({
      id: row.id,
      title: row.title,
      critical: rowSeverity.critical,
      warn: rowSeverity.warn,
      info: rowSeverity.info,
    });
  }
  for (const i of chartIssues) {
    bumpSeverity(severity, i.severity);
    if (!byCode[i.code]) byCode[i.code] = [];
    byCode[i.code].push({ id: entity.id, title: entity.name });
    codeSeverity[i.code] = i.severity;
  }

  return {
    rowsWithGaps,
    totalRows: rows.length,
    chartIssueCount: chartIssues.length,
    byCode,
    codeSeverity,
    severity,
    childRollup,
    chartIssues,
  };
}

/** Headline string. Omits a clause when its count is zero. */
export function formatHeadline(summary: Summary): string {
  const rowClause = `${summary.rowsWithGaps} of ${summary.totalRows} rows have data gaps`;
  const chartClause = `${summary.chartIssueCount} chart-level issue${summary.chartIssueCount === 1 ? "" : "s"}`;
  if (summary.rowsWithGaps === 0 && summary.chartIssueCount === 0) {
    return `0 of ${summary.totalRows} rows have data gaps`;
  }
  if (summary.chartIssueCount === 0) return rowClause;
  if (summary.rowsWithGaps === 0) return `${rowClause} + ${chartClause}`;
  return `${rowClause} + ${chartClause}`;
}

/** "3 critical · 7 warn · 2 info" — omits zeros, clean if all zero. */
export function formatSeverityLine(s: SeverityCounts): string {
  const parts: string[] = [];
  if (s.critical > 0) parts.push(`${s.critical} critical`);
  if (s.warn > 0) parts.push(`${s.warn} warn`);
  if (s.info > 0) parts.push(`${s.info} info`);
  return parts.length === 0 ? "clean" : parts.join(" · ");
}

/** Sorted, friendly-labelled itemized lines. Keyed by IssueCode. */
function entries(summary: Summary): { code: string; refs: { id: string; title: string }[] }[] {
  return Object.keys(summary.byCode)
    .sort()
    .map((code) => ({ code, refs: summary.byCode[code] }));
}

/** Render the counter slot for the GanttTemplate. */
export function formatCounterMarkup(summary: Summary): ReactNode {
  const items = entries(summary);
  return (
    <section className="counter">
      <h2 className="counter-headline">{formatHeadline(summary)}</h2>
      <div className="counter-severity">{formatSeverityLine(summary.severity)}</div>
      {items.length > 0 && (
        <ul className="counter-breakdown">
          {items.map(({ code, refs }) => (
            <li key={code}>
              <code className="issue-code">{code}</code>
              <span className="issue-count"> ({refs.length})</span>
              <span className="issue-refs">: {refs.map((r) => r.title).join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Plain-text counter mirror for the CLI's stdout. Same data as
 * `formatCounterMarkup`, formatted as: headline + severity line +
 * indented per-code lines + absolute output path on the final line.
 */
export function formatCounterConsole(summary: Summary, outputPath: string): string {
  const lines = [formatHeadline(summary), `  ${formatSeverityLine(summary.severity)}`];
  for (const { code, refs } of entries(summary)) {
    const titles = refs.map((r) => r.title).join(", ");
    lines.push(`  [${code}] (${refs.length}): ${titles}`);
  }
  lines.push(`Wrote: ${outputPath}`);
  return lines.join("\n");
}
