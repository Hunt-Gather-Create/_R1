/**
 * Row classifier — §2.2 row taxonomy, extended with variance found in the
 * 2026-07-24 fixture sweep:
 *   - "leaf-unnumbered": indented + dated but no numeric prefix
 *     (Soundly row 47 "   Buffer / contingency"). The Appendix D regex alone
 *     would silently drop these.
 *   - Milestones can carry predecessor/lag values and appear mid-sheet (ITEP).
 *   - Rollup detection is span-based (two-pass), not position-based: ITEP's
 *     first data row is a section header, not a rollup.
 */
import { parseSheetDate } from "./parse-dates";
import type { ClassifiedRow, RowType } from "./types";

export const LEAF_PREFIX = /^\s+(\d+(?:\.\d+)?)\s+/;

const COL = { B: 1, C: 2, E: 4, F: 5 } as const;

function cell(row: (string | undefined)[], idx: number): string {
  return String(row[idx] ?? "");
}

export function isColumnHeaderRow(row: (string | undefined)[]): boolean {
  return cell(row, COL.B).trim() === "✔" && cell(row, COL.C).trim() === "TASKS";
}

/**
 * First-pass classification of a single data row (below the column header).
 * Rollups are indistinguishable from section headers here; the span-based
 * second pass in classifyRows promotes at most one section-header to rollup.
 */
function classifyDataRow(row: (string | undefined)[]): RowType {
  const rawC = cell(row, COL.C);
  const c = rawC.trim();
  const b = cell(row, COL.B).trim().toUpperCase();
  const hasDates =
    parseSheetDate(cell(row, COL.E)) !== null || parseSheetDate(cell(row, COL.F)) !== null;

  if (c === "") {
    if (b === "FALSE" || b === "TRUE" || hasDates) return "empty-template";
    return "spacer";
  }
  if (c.startsWith("***") || (c.startsWith("*") && c.endsWith("*") && c.includes("***"))) {
    return "milestone";
  }
  if (LEAF_PREFIX.test(rawC)) return "leaf";
  // Indented content without a numeric prefix: a real task row when dated.
  if (/^\s/.test(rawC)) return hasDates ? "leaf-unnumbered" : "section-header";
  return "section-header";
}

/**
 * Classify all rows of a sheet grid. Returns classified rows plus the
 * 1-based column-header row number (or -1 when the contract row is absent).
 */
export function classifyRows(values: (string | undefined)[][]): {
  rows: ClassifiedRow[];
  headerRowNumber: number;
} {
  const rows: ClassifiedRow[] = [];
  let headerRowNumber = -1;

  for (let i = 0; i < values.length; i++) {
    const raw = values[i] ?? [];
    const rowNumber = i + 1;
    let type: RowType;
    if (headerRowNumber === -1) {
      if (isColumnHeaderRow(raw)) {
        headerRowNumber = rowNumber;
        type = "column-header";
      } else {
        type = "pre-header";
      }
    } else {
      type = classifyDataRow(raw);
    }
    rows.push({ rowNumber, type, raw });
  }

  promoteRollup(rows);
  return { rows, headerRowNumber };
}

/**
 * Second pass: a section-header whose [start, end] date span envelopes every
 * leaf task's dates is the engagement rollup (LPPC "Phase 2.1 Release").
 * At most the first such row is promoted. Sheets without one (ITEP, Soundly)
 * simply have no rollup row.
 */
function promoteRollup(rows: ClassifiedRow[]): void {
  const leafDates: string[] = [];
  for (const r of rows) {
    if (r.type !== "leaf" && r.type !== "leaf-unnumbered") continue;
    const s = parseSheetDate(cell(r.raw, COL.E));
    const e = parseSheetDate(cell(r.raw, COL.F));
    if (s) leafDates.push(s);
    if (e) leafDates.push(e);
  }
  if (leafDates.length === 0) return;
  const min = leafDates.reduce((a, b) => (a < b ? a : b));
  const max = leafDates.reduce((a, b) => (a > b ? a : b));

  for (const r of rows) {
    if (r.type !== "section-header") continue;
    const s = parseSheetDate(cell(r.raw, COL.E));
    const e = parseSheetDate(cell(r.raw, COL.F));
    if (s && e && s <= min && e >= max) {
      r.type = "rollup";
      return;
    }
  }
}
