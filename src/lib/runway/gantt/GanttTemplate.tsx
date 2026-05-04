/**
 * Static HTML template for a single Gantt render. Rendered server-side via
 * `renderToStaticMarkup`. Self-contained: inline `<style>` block, no JS.
 *
 * Render order (operator-locked):
 *   1. Header (name + raw date range + generated stamp)
 *   2. Per-section legend (inside each SectionBlock, above DataIntegrityPanel)
 *   3. Data Integrity panel (severity rollup + grouped issues + per-child
 *      rollup for wrapper view) — light-internal only
 *   4. Gantt body (table-style row + sub-row alerts)
 *
 * The panel replaces the older "counter + alerts" duo. Chart-level issues
 * render with full messages; row-level issues collapse to code + count +
 * affected entity titles (their full messages already render on the row's
 * sub-row in the body below).
 */

import * as React from "react";
// react-dom/server is loaded lazily via require() inside renderGantt /
// renderClientRundown to break Turbopack's static module-condition analysis.
// ES `import` of react-dom/server is banned in App Router module graphs;
// CommonJS `require()` calls are not traced by Turbopack's static analyzer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
import { formatHeadline } from "./counter";
import { getThemeTokens } from "./themes";
import type {
  AnnotatedRow,
  AxisParams,
  ChildRollupEntry,
  ClientRundownData,
  GanttData,
  Issue,
  RundownSection,
  Severity,
  SeverityCounts,
  Summary,
  Theme,
} from "./types";

function numericDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

function DateOrNull({ value }: { value: string | null }): JSX.Element {
  if (value === null) return <span className="null">null</span>;
  return <span>{numericDate(value)}</span>;
}

// ── Bar / marker geometry ─────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseISO(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function dayDiff(from: string, to: string): number {
  return Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / MS_PER_DAY);
}

function clampPct(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

type BarGeometry =
  | { kind: "bar"; left: number; width: number }
  | { kind: "milestone"; left: number }
  | { kind: "none" };

export function computeBarGeometry(row: AnnotatedRow, axis: AxisParams): BarGeometry {
  if (axis.kind === "no-axis") return { kind: "none" };
  if (row.startDate === null || row.endDate === null) return { kind: "none" };
  if (row.endDate < row.startDate) return { kind: "none" };
  const totalDays = dayDiff(axis.start, axis.end);
  if (totalDays <= 0) return { kind: "none" };
  if (row.startDate === row.endDate) {
    const left = clampPct((dayDiff(axis.start, row.startDate) / totalDays) * 100);
    return { kind: "milestone", left };
  }
  const left = clampPct((dayDiff(axis.start, row.startDate) / totalDays) * 100);
  const widthDays = dayDiff(row.startDate, row.endDate) + 1;
  const width = clampPct((widthDays / totalDays) * 100);
  return { kind: "bar", left, width };
}

export function computeTodayPosition(axis: AxisParams): number | null {
  if (axis.kind === "no-axis") return null;
  if (axis.today < axis.start || axis.today >= axis.end) return null;
  const totalDays = dayDiff(axis.start, axis.end);
  if (totalDays <= 0) return null;
  return clampPct((dayDiff(axis.start, axis.today) / totalDays) * 100);
}

// ── Component ─────────────────────────────────────────────

const STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; margin: 0; padding: 0; color: #222; background: #fafafa; }
  .gantt { max-width: 1400px; margin: 24px auto; padding: 20px 24px; background: #fff; border: 1px solid #e3e3e3; border-radius: 6px; }
  .header { border-bottom: 1px solid #e3e3e3; padding-bottom: 12px; margin-bottom: 16px; }
  .header h1 { margin: 0 0 4px 0; font-size: 20px; font-weight: 600; }
  .header .meta { font-size: 12px; color: #777; }

  /* Legend — actual rendered swatches, not text-only */
  .legend { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-top: 10px; font-size: 11px; color: #555; }
  .legend-in-section { margin: 8px 0 12px 0; }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .legend-swatch { display: inline-block; width: 28px; height: 12px; border-radius: 2px; }
  .legend-swatch.active { background: #3b82f6; }
  /* Scheduled = placeholder/upcoming. Pale blue with dashed border to
     read as "outline-only, not yet started". */
  .legend-swatch.scheduled { background: #eff6ff; border: 1px dashed #93c5fd; box-sizing: border-box; }
  .legend-swatch.at-risk { background: #f59e0b; }
  .legend-swatch.blocked { background: #ef4444; }
  /* Completed = done. Solid muted green so it reads "✓ landed" rather
     than "faded blue scheduled" — the operator (2026-04-30) called out
     that the three muted-grey states blurred together. */
  .legend-swatch.completed { background: #86efac; border: 1px solid #4ade80; box-sizing: border-box; }
  /* Canceled = killed. Diagonal strikethrough overlay on grey. */
  .legend-swatch.canceled { background: linear-gradient(to top right, transparent calc(50% - 1px), #64748b calc(50% - 1px), #64748b calc(50% + 1px), transparent calc(50% + 1px)), #cbd5e1; }
  .legend-diamond { display: inline-block; width: 11px; height: 11px; transform: rotate(45deg); background: #6366f1; }
  .legend-alert { color: #d97706; font-weight: 600; font-size: 12px; }
  .legend-strike { text-decoration: line-through; color: #94a3b8; }

  /* Data Integrity panel — compact, flat, emoji-led. Operator
     (2026-04-30) called out the nested colored boxes as wasted vertical
     space. New layout: one-line header (title + severity counts on the
     right), single flat issue list, full-width content. */
  .panel { border: 1px solid #e3e3e3; border-radius: 6px; margin: 12px 0 18px 0; background: #fff; }
  .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #f3f3f3; }
  .panel-head .panel-title { font-size: 12px; font-weight: 700; color: #444; text-transform: uppercase; letter-spacing: 0.6px; }
  .panel-head .panel-counts { font-size: 13px; font-weight: 600; }
  .panel-head .panel-counts.critical { color: #b91c1c; }
  .panel-head .panel-counts.warn { color: #b45309; }
  .panel-head .panel-counts.clean { color: #15803d; }
  .panel-sub { padding: 4px 14px 8px; font-size: 11px; color: #777; }
  .panel-clean { padding: 14px; font-size: 13px; color: #166534; background: #f0fdf4; border-top: 1px solid #f3f3f3; display: flex; align-items: center; gap: 8px; }
  .panel-issues { margin: 0; padding: 6px 14px 12px 14px; list-style: none; font-size: 12px; }
  .panel-issues li { display: flex; align-items: baseline; gap: 8px; padding: 4px 0; border-top: 1px dashed #f1f5f9; }
  .panel-issues li:first-child { border-top: 0; }
  .panel-issues .sev-emoji { flex: 0 0 auto; font-size: 13px; line-height: 1; }
  .panel-issues code { background: rgba(0,0,0,0.05); padding: 1px 6px; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 11px; flex: 0 0 auto; }
  .panel-issues .issue-count { color: #888; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
  .panel-issues .issue-message { color: #334155; }
  .panel-issues .issue-refs { color: #475569; }

  /* Per-child rollup — same 3-column packed layout as wrapper TOC so
     a long child list (16+ rows) stays scannable instead of stretching
     the panel into a tall single column. */
  .panel-rollup { padding: 12px 14px; border-top: 1px solid #f3f3f3; }
  .panel-rollup h3 { margin: 0 0 10px 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; }
  .panel-rollup ul { margin: 0; padding: 0; list-style: none; columns: 3; column-gap: 28px; column-rule: 1px solid #e5e7eb; }
  .panel-rollup li { break-inside: avoid; display: flex; align-items: baseline; gap: 6px; padding: 3px 0; font-size: 12px; }
  .panel-rollup .rollup-emoji { flex: 0 0 auto; font-size: 12px; line-height: 1; }
  .panel-rollup .title { font-weight: 500; color: #1f2937; }
  .panel-rollup .tally { font-variant-numeric: tabular-nums; white-space: nowrap; margin-left: auto; padding-left: 6px; font-size: 11px; }
  .panel-rollup .tally.critical { color: #b91c1c; font-weight: 600; }
  .panel-rollup .tally.warn { color: #b45309; }
  .panel-rollup .tally.info { color: #64748b; }
  .panel-rollup .tally.clean { color: #15803d; }

  /* Body */
  .body { margin-top: 16px; }
  .axis-row { display: grid; grid-template-columns: 340px 200px 130px 1fr; align-items: end; font-size: 11px; color: #888; padding: 4px 0; border-bottom: 1px solid #ddd; }
  .axis-spacer { grid-column: span 3; }
  .axis-cells { position: relative; height: 18px; }
  .axis-cell { position: absolute; top: 0; bottom: 0; padding-left: 4px; border-left: 1px solid #d1d5db; font-size: 10px; color: #555; }
  .axis-cell.minor { border-left-color: #f1f5f9; color: transparent; }
  .row { display: grid; grid-template-columns: 340px 200px 130px 1fr; align-items: center; padding: 6px 0; border-bottom: 1px solid #f3f3f3; min-height: 28px; }
  .row .title { font-size: 13px; font-weight: 500; padding-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .meta { font-size: 11px; color: #666; padding-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .dates { font-size: 11px; color: #555; font-variant-numeric: tabular-nums; padding-right: 8px; }
  .row .dates.bad { color: #c0392b; font-weight: 600; }
  .row .dates .null { color: #c0392b; font-weight: 600; }
  .timeline { position: relative; height: 22px; background: #fafafa; border-radius: 3px; }
  .grid-line { position: absolute; top: 0; bottom: 0; width: 1px; background: #f1f5f9; }
  .grid-line.major { background: #e2e8f0; }
  /* Status-driven bar colors. Default to "active" blue; status-class
     overrides paint scheduled/at-risk/blocked. completed/canceled use
     distinct semantics (green = done, strikethrough = killed) so the
     three muted states don't blur. */
  .bar { position: absolute; top: 4px; bottom: 4px; background: #3b82f6; border-radius: 2px; }
  .bar.scheduled { background: #eff6ff; border: 1px dashed #93c5fd; box-sizing: border-box; }
  .bar.at-risk { background: #f59e0b; }
  .bar.blocked { background: #ef4444; }
  .row.completed .bar { background: #86efac; border: 1px solid #4ade80; box-sizing: border-box; opacity: 1; }
  .row.completed .title, .row.completed .meta, .row.completed .dates { color: #475569; }
  .row.canceled .bar { background: linear-gradient(to top right, transparent calc(50% - 1px), #64748b calc(50% - 1px), #64748b calc(50% + 1px), transparent calc(50% + 1px)), #cbd5e1; opacity: 1; }
  .row.canceled .title, .row.canceled .meta, .row.canceled .dates { text-decoration: line-through; color: #94a3b8; }
  .milestone { position: absolute; top: 4px; width: 14px; height: 14px; transform: translateX(-7px) rotate(45deg); background: #6366f1; }
  .milestone.scheduled { background: #eff6ff; border: 1px dashed #93c5fd; box-sizing: border-box; }
  .milestone.at-risk { background: #f59e0b; }
  .milestone.blocked { background: #ef4444; }
  .row.completed .milestone { background: #86efac; border: 1px solid #4ade80; box-sizing: border-box; }
  .row.canceled .milestone { background: #cbd5e1; opacity: 0.6; }
  .today-line { position: absolute; top: 0; bottom: 0; width: 1px; background: #ef4444; pointer-events: none; z-index: 2; }
  .today-label { position: absolute; top: -14px; transform: translateX(-50%); font-size: 9px; color: #ef4444; white-space: nowrap; }
  .row .alert-badge.critical { color: #b91c1c; }
  .row .alert-badge.warn { color: #d97706; }
  .row .alert-badge.info { color: #64748b; }
  .alert-badge { font-weight: 600; margin-left: 6px; font-size: 11px; }
  .sub-row { padding: 4px 12px 4px 348px; font-size: 11px; }
  .sub-row.critical { background: #fef2f2; border-left: 3px solid #b91c1c; color: #7f1d1d; }
  .sub-row.warn { background: #fffbeb; border-left: 3px solid #d97706; color: #5a3a0c; }
  .sub-row.info { background: #f8fafc; border-left: 3px solid #64748b; color: #334155; }
  .sub-row .alert-line { display: block; margin: 1px 0; }
  .sub-row code { background: rgba(0,0,0,0.06); padding: 0 4px; border-radius: 2px; font-family: ui-monospace, monospace; font-size: 10px; }
  .no-axis-note { font-size: 11px; color: #888; padding: 10px; text-align: center; background: #fafafa; border-radius: 4px; margin: 8px 0; }

  /* Rundown (client-level multi-section page) */
  .rundown-head { padding: 4px 4px 16px; border-bottom: 2px solid #e3e3e3; margin-bottom: 18px; }
  .rundown-head h1 { margin: 0; font-size: 24px; font-weight: 700; }
  .rundown-head .meta { font-size: 12px; color: #777; margin-top: 4px; }
  .rundown-overall { font-size: 14px; font-weight: 600; margin-top: 8px; }
  .rundown-overall.critical { color: #b91c1c; }
  .rundown-overall.warn { color: #b45309; }
  .rundown-overall.clean { color: #15803d; }
  /* TOC — card grid (operator 2026-04-30: single tall column wasted
     horizontal space). Top-level blocks lay out in a responsive grid;
     wrapper children pack into a 2-column inner list inside each card. */
  .rundown-toc { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; margin: 16px 0 24px; }
  .rundown-toc h2 { margin: 0 0 10px 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #475569; }

  .toc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px 18px; }
  .toc-block { background: #fff; border: 1px solid #e5e7eb; border-radius: 5px; padding: 8px 12px; }
  .toc-block.wrapper { border-color: #c4b5fd; background: #fbfaff; grid-column: 1 / -1; }
  .toc-block-head { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
  .toc-block-head .toc-emoji { flex: 0 0 auto; font-size: 14px; line-height: 1; }
  .toc-block-head a { color: #1e40af; text-decoration: none; font-weight: 600; }
  .toc-block-head a:hover { text-decoration: underline; }
  .toc-block-head .toc-tally { font-size: 11px; margin-left: auto; padding-left: 8px; }
  .toc-block-head .toc-tally.critical { color: #b91c1c; font-weight: 600; }
  .toc-block-head .toc-tally.warn { color: #b45309; }
  .toc-block-head .toc-tally.clean { color: #15803d; }

  /* Wrapper children — 3-column packed list with a thin vertical
     separator between columns. Multi-column was the right shape but
     2-cols still left horizontal space; 3-cols + column-rule gives a
     scannable visual language (operator 2026-04-30). */
  .toc-children { margin: 8px 0 0 0; padding: 8px 0 0 0; list-style: none; columns: 3; column-gap: 28px; column-rule: 1px solid #e5e7eb; border-top: 1px solid #ede9fe; }
  .toc-children li { break-inside: avoid; display: flex; align-items: baseline; gap: 6px; padding: 3px 0; font-size: 12px; }
  .toc-children .toc-emoji { flex: 0 0 auto; font-size: 12px; line-height: 1; }
  .toc-children a { color: #1e40af; text-decoration: none; }
  .toc-children a:hover { text-decoration: underline; }
  .toc-children .toc-tally { color: #64748b; font-size: 11px; margin-left: auto; padding-left: 6px; }
  .toc-children .toc-tally.critical { color: #b91c1c; font-weight: 600; }
  .toc-children .toc-tally.warn { color: #b45309; }
  .toc-children .toc-tally.clean { color: #15803d; }

  .rundown-section { margin: 22px 0 36px 0; padding-top: 12px; border-top: 1px solid #d1d5db; }
  .rundown-section .section-head h2 { margin: 0; font-size: 17px; font-weight: 600; }
  .rundown-section .section-head .kind-tag { display: inline-block; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 6px; border-radius: 3px; margin-left: 8px; vertical-align: middle; }
  .rundown-section .section-head .kind-tag.wrapper { background: #ddd6fe; color: #5b21b6; }
  .rundown-section .section-head .kind-tag.wrapper-child { background: #e0f2fe; color: #075985; }
  .rundown-section .section-head .kind-tag.standalone { background: #f1f5f9; color: #475569; }
  .rundown-section .section-head .meta { font-size: 11px; color: #777; margin-top: 2px; }
`;

const STYLES_BRANDED = `
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; margin: 0; padding: 0; color: #333333; background: #ffffff; }
  .gantt { max-width: 1400px; margin: 24px auto; padding: 20px 24px; background: #ffffff; border: 1px solid #E5E7EB; border-radius: 6px; }
  .header { border-bottom: 2px solid #0E5DFF; padding-bottom: 12px; margin-bottom: 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .header-text { flex: 1 1 auto; }
  .header h1 { margin: 0 0 4px 0; font-size: 20px; font-weight: 700; color: #000000; }
  .header .meta { font-size: 12px; color: #333333; }
  .header-logo { flex: 0 0 auto; max-height: 0.85in; max-width: 2in; object-fit: contain; }

  /* Legend — brand palette */
  .legend { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; margin-top: 10px; font-size: 11px; color: #333333; }
  .legend-in-section { margin: 8px 0 12px 0; }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .legend-swatch { display: inline-block; width: 28px; height: 12px; border-radius: 2px; }
  .legend-swatch.active { background: #0E5DFF; }
  .legend-swatch.scheduled { background: #F9FAFB; border: 1px dashed #D1D5DB; box-sizing: border-box; }
  .legend-swatch.at-risk { background: #F59E0B; opacity: 0.7; }
  .legend-swatch.blocked { background: #DC2626; opacity: 0.7; }
  .legend-swatch.completed { background: #10B981; opacity: 0.6; border: 1px solid #059669; box-sizing: border-box; }
  .legend-swatch.canceled { background: #9CA3AF; }
  .legend-diamond { display: inline-block; width: 11px; height: 11px; transform: rotate(45deg); background: #0E5DFF; }
  .legend-strike { text-decoration: line-through; color: #9CA3AF; }

  /* Body */
  .body { margin-top: 16px; }
  .axis-row { display: grid; grid-template-columns: 340px 200px 130px 1fr; align-items: end; font-size: 11px; color: #333333; padding: 4px 0; border-bottom: 1px solid #E5E7EB; }
  .axis-spacer { grid-column: span 3; }
  .axis-cells { position: relative; height: 18px; }
  .axis-cell { position: absolute; top: 0; bottom: 0; padding-left: 4px; border-left: 1px solid #E5E7EB; font-size: 10px; color: #333333; }
  .axis-cell.minor { border-left-color: #F9FAFB; color: transparent; }
  .row { display: grid; grid-template-columns: 340px 200px 130px 1fr; align-items: center; padding: 6px 0; border-bottom: 1px solid #E5E7EB; min-height: 28px; }
  .row .title { font-size: 13px; font-weight: 600; padding-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #000000; }
  .row .meta { font-size: 11px; color: #333333; padding-right: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .dates { font-size: 11px; color: #333333; font-variant-numeric: tabular-nums; padding-right: 8px; }
  .row .dates.bad { color: #DC2626; font-weight: 600; }
  .row .dates .null { color: #DC2626; font-weight: 600; }
  .timeline { position: relative; height: 22px; background: #F9FAFB; border-radius: 3px; }
  .grid-line { position: absolute; top: 0; bottom: 0; width: 1px; background: #F9FAFB; }
  .grid-line.major { background: #E5E7EB; }
  .bar { position: absolute; top: 4px; bottom: 4px; background: #0E5DFF; border-radius: 2px; }
  .bar.scheduled { background: #F9FAFB; border: 1px dashed #D1D5DB; box-sizing: border-box; }
  .bar.at-risk { background: #F59E0B; opacity: 0.7; }
  .bar.blocked { background: #DC2626; opacity: 0.7; }
  .row.completed .bar { background: #10B981; border: 1px solid #059669; box-sizing: border-box; opacity: 0.6; }
  .row.completed .title, .row.completed .meta, .row.completed .dates { color: #333333; }
  .row.canceled .bar { background: #9CA3AF; opacity: 1; }
  .row.canceled .title, .row.canceled .meta, .row.canceled .dates { text-decoration: line-through; color: #9CA3AF; }
  .milestone { position: absolute; top: 4px; width: 14px; height: 14px; transform: translateX(-7px) rotate(45deg); background: #0E5DFF; }
  .milestone.scheduled { background: #F9FAFB; border: 1px dashed #D1D5DB; box-sizing: border-box; }
  .milestone.at-risk { background: #F59E0B; opacity: 0.7; }
  .milestone.blocked { background: #DC2626; opacity: 0.7; }
  .row.completed .milestone { background: #10B981; border: 1px solid #059669; box-sizing: border-box; opacity: 0.6; }
  .row.canceled .milestone { background: #9CA3AF; opacity: 0.6; }
  .today-line { position: absolute; top: 0; bottom: 0; width: 2px; background: #0E5DFF; pointer-events: none; z-index: 2; }
  .today-label { position: absolute; top: -14px; transform: translateX(-50%); font-size: 9px; color: #0E5DFF; white-space: nowrap; }
  .no-axis-note { font-size: 11px; color: #333333; padding: 10px; text-align: center; background: #F9FAFB; border-radius: 4px; margin: 8px 0; }

  /* Rundown */
  .rundown-head { padding: 4px 4px 16px; border-bottom: 2px solid #0E5DFF; margin-bottom: 18px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .rundown-head-text { flex: 1 1 auto; }
  .rundown-head h1 { margin: 0; font-size: 24px; font-weight: 700; color: #000000; }
  .rundown-head .meta { font-size: 12px; color: #333333; margin-top: 4px; }
  .header-logo { flex: 0 0 auto; max-height: 0.85in; max-width: 2in; object-fit: contain; }
  .rundown-toc { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; padding: 14px 16px; margin: 16px 0 24px; }
  .rundown-toc h2 { margin: 0 0 10px 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #333333; }
  .toc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px 18px; }
  .toc-block { background: #ffffff; border: 1px solid #E5E7EB; border-radius: 5px; padding: 8px 12px; }
  .toc-block.wrapper { border-color: #0E5DFF; background: #F9FAFB; grid-column: 1 / -1; }
  .toc-block-head { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
  .toc-block-head .toc-emoji { flex: 0 0 auto; font-size: 14px; line-height: 1; }
  .toc-block-head a { color: #0E5DFF; text-decoration: none; font-weight: 600; }
  .toc-block-head a:hover { text-decoration: underline; }
  .toc-block-head .toc-tally { font-size: 11px; margin-left: auto; padding-left: 8px; }
  .toc-children { margin: 8px 0 0 0; padding: 8px 0 0 0; list-style: none; columns: 3; column-gap: 28px; column-rule: 1px solid #E5E7EB; border-top: 1px solid #E5E7EB; }
  .toc-children li { break-inside: avoid; display: flex; align-items: baseline; gap: 6px; padding: 3px 0; font-size: 12px; }
  .toc-children .toc-emoji { flex: 0 0 auto; font-size: 12px; line-height: 1; }
  .toc-children a { color: #0E5DFF; text-decoration: none; }
  .toc-children .toc-tally { color: #333333; font-size: 11px; margin-left: auto; padding-left: 6px; }
  .rundown-section { margin: 22px 0 36px 0; padding-top: 12px; border-top: 1px solid #E5E7EB; }
  .rundown-section .section-head h2 { margin: 0; font-size: 17px; font-weight: 700; color: #000000; }
  .rundown-section .section-head .kind-tag { display: inline-block; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 6px; border-radius: 3px; margin-left: 8px; vertical-align: middle; background: #F9FAFB; color: #333333; border: 1px solid #E5E7EB; }
  .rundown-section .section-head .meta { font-size: 11px; color: #333333; margin-top: 2px; }
`;

function metaLine(row: AnnotatedRow): string {
  const ownerPart = row.owner ? `O: ${row.owner}` : "";
  const resourcesPart = row.resources ?? "";
  return [ownerPart, resourcesPart].filter(Boolean).join(" · ");
}

function rowClass(row: AnnotatedRow): string {
  const classes = ["row"];
  if (row.kind === "weekitem" || row.kind === "project") {
    if (row.status === "completed") classes.push("completed");
    if (row.status === "canceled") classes.push("canceled");
  }
  return classes.join(" ");
}

function inlineDateClass(row: AnnotatedRow): string {
  return row.inline.length > 0 ? "dates bad" : "dates";
}

function chartLabel(data: GanttData): string {
  return data.raw.kind === "wrapper" ? "Wrapper" : "L1";
}

/** The most-severe severity present on a row, for badge coloring. */
function highestSeverity(issues: Issue[]): Severity | null {
  if (issues.some((i) => i.severity === "critical")) return "critical";
  if (issues.some((i) => i.severity === "warn")) return "warn";
  if (issues.some((i) => i.severity === "info")) return "info";
  return null;
}

// ── Data Integrity panel ─────────────────────────────────

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: "🔴",
  warn: "🟡",
  info: "🔵",
};

type PanelEntry =
  | { kind: "chart"; issue: Issue }
  | { kind: "row-group"; code: string; severity: Severity; refs: { id: string; title: string }[] };

function entrySeverity(e: PanelEntry): Severity {
  return e.kind === "chart" ? e.issue.severity : e.severity;
}

function entryCode(e: PanelEntry): string {
  return e.kind === "chart" ? e.issue.code : e.code;
}

/**
 * Single flat list of every issue, sorted by severity then by code. The
 * old design grouped into nested colored boxes per severity which wasted
 * a lot of vertical space and crowded the issue text into a narrow column.
 */
function buildPanelEntries(summary: Summary): PanelEntry[] {
  const entries: PanelEntry[] = [];
  for (const ci of summary.chartIssues) {
    entries.push({ kind: "chart", issue: ci });
  }
  const chartCodes = new Set(summary.chartIssues.map((i) => i.code));
  for (const code of Object.keys(summary.byCode).filter((c) => !chartCodes.has(c as Issue["code"]))) {
    entries.push({
      kind: "row-group",
      code,
      severity: summary.codeSeverity[code] ?? "warn",
      refs: summary.byCode[code],
    });
  }
  entries.sort((a, b) => {
    const sd = SEVERITY_RANK[entrySeverity(a)] - SEVERITY_RANK[entrySeverity(b)];
    if (sd !== 0) return sd;
    return entryCode(a).localeCompare(entryCode(b));
  });
  return entries;
}

function PanelEntryItem({ entry }: { entry: PanelEntry }): JSX.Element {
  const sev = entrySeverity(entry);
  if (entry.kind === "chart") {
    return (
      <li>
        <span className="sev-emoji" aria-label={sev}>
          {SEVERITY_EMOJI[sev]}
        </span>
        <code>{entry.issue.code}</code>
        <span className="issue-message">— {entry.issue.message}</span>
      </li>
    );
  }
  const titles = entry.refs.map((r) => r.title).join(", ");
  return (
    <li>
      <span className="sev-emoji" aria-label={sev}>
        {SEVERITY_EMOJI[sev]}
      </span>
      <code>{entry.code}</code>
      <span className="issue-count">({entry.refs.length})</span>
      <span className="issue-refs">— {titles}</span>
    </li>
  );
}

function panelCountsClass(s: Summary["severity"]): string {
  if (s.critical > 0) return "panel-counts critical";
  if (s.warn > 0 || s.info > 0) return "panel-counts warn";
  return "panel-counts clean";
}

function panelCountsLabel(s: Summary["severity"]): string {
  if (s.critical + s.warn + s.info === 0) return "✅ Clean";
  const parts: string[] = [];
  if (s.critical > 0) parts.push(`🔴 ${s.critical} critical`);
  if (s.warn > 0) parts.push(`🟡 ${s.warn} warn`);
  if (s.info > 0) parts.push(`🔵 ${s.info} info`);
  return parts.join("  ·  ");
}

function rollupEmoji(e: ChildRollupEntry): string {
  if (e.critical > 0) return "🔴";
  if (e.warn > 0) return "🟡";
  if (e.info > 0) return "🔵";
  return "✅";
}

function rollupTallyClass(e: ChildRollupEntry): string {
  if (e.critical > 0) return "tally critical";
  if (e.warn > 0) return "tally warn";
  if (e.info > 0) return "tally info";
  return "tally clean";
}

function rollupTallyText(e: ChildRollupEntry): string {
  if (e.critical + e.warn + e.info === 0) return "clean";
  const parts: string[] = [];
  if (e.critical > 0) parts.push(`${e.critical} critical`);
  if (e.warn > 0) parts.push(`${e.warn} warn`);
  if (e.info > 0) parts.push(`${e.info} info`);
  return parts.join(" · ");
}

function PerChildRollup({ entries }: { entries: ChildRollupEntry[] }): JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <div className="panel-rollup">
      <h3>Per-child rollup</h3>
      <ul>
        {entries.map((e) => (
          <li key={e.id}>
            <span className="rollup-emoji" aria-hidden="true">
              {rollupEmoji(e)}
            </span>
            <span className="title">{e.title}</span>
            <span className={rollupTallyClass(e)}>{rollupTallyText(e)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DataIntegrityPanel({
  summary,
  isWrapper,
}: {
  summary: Summary;
  isWrapper: boolean;
}): JSX.Element {
  const entries = buildPanelEntries(summary);
  const isClean = entries.length === 0;
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">Data Integrity</span>
        <span className={panelCountsClass(summary.severity)}>
          {panelCountsLabel(summary.severity)}
        </span>
      </div>
      {isClean ? (
        <div className="panel-clean">
          <span className="sev-emoji">✅</span>
          <span>{formatHeadline(summary)} — all checks passed.</span>
        </div>
      ) : (
        <>
          <div className="panel-sub">{formatHeadline(summary)}</div>
          <ul className="panel-issues">
            {entries.map((entry, i) => (
              <PanelEntryItem
                key={`${entryCode(entry)}-${i}`}
                entry={entry}
              />
            ))}
          </ul>
        </>
      )}
      {isWrapper && summary.childRollup && <PerChildRollup entries={summary.childRollup} />}
    </section>
  );
}

// ── Legend ────────────────────────────────────────────────

/**
 * Light-internal and light-branded legend (swatches + labels). Used by
 * SectionLegend as the default rendering path for both light themes.
 * Positioned inside each SectionBlock, above the DataIntegrityPanel.
 * Margin tuned for in-section position via .legend-in-section class.
 */
function SectionLegendLight(): JSX.Element {
  return (
    <div className="legend legend-in-section">
      <span className="legend-item">
        <span className="legend-swatch active" /> in-progress
      </span>
      <span className="legend-item">
        <span className="legend-swatch scheduled" /> scheduled
      </span>
      <span className="legend-item">
        <span className="legend-swatch at-risk" /> at-risk
      </span>
      <span className="legend-item">
        <span className="legend-swatch blocked" /> blocked
      </span>
      <span className="legend-item">
        <span className="legend-swatch completed" /> completed
      </span>
      <span className="legend-item">
        <span className="legend-swatch canceled" /> <span className="legend-strike">canceled</span>
      </span>
      <span className="legend-item">
        <span className="legend-diamond" /> milestone
      </span>
    </div>
  );
}

/**
 * Dark-account-view legend using Tailwind classes for swatches.
 */
function SectionLegendDark(): JSX.Element {
  return (
    <div className="flex flex-wrap gap-3 items-center text-xs text-slate-400 mb-3">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-7 h-3 rounded-sm bg-sky-400" /> in-progress
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-7 h-3 rounded-sm border border-slate-500/40 bg-slate-500/10" /> scheduled
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-7 h-3 rounded-sm bg-amber-400" /> at-risk
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-7 h-3 rounded-sm bg-red-400" /> blocked
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-7 h-3 rounded-sm bg-emerald-400" /> completed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-7 h-3 rounded-sm bg-slate-400" /> <span className="line-through opacity-60">canceled</span>
      </span>
    </div>
  );
}

/**
 * Per-section legend dispatcher. Renders above DataIntegrityPanel in every
 * SectionBlock. Theme drives swatch styles.
 */
export function SectionLegend({ theme }: { theme: Theme }): JSX.Element {
  if (theme === "dark-account-view") return <SectionLegendDark />;
  return <SectionLegendLight />;
}

// ── Status → bar color class ──────────────────────────────
// Operator semantic (2026-04-30): bar color tracks status, not just
// calendar overlap. `scheduled` / null / not-started → pale; `at-risk` →
// amber; `blocked` → red; `in-progress` → full blue (default). The row
// classes (`completed`, `canceled`) still own their fade/strikethrough.

function statusClass(row: AnnotatedRow): string {
  const status = row.status ?? "scheduled";
  if (status === "scheduled" || status === "not-started" || status === "on-hold") {
    return "scheduled";
  }
  if (status === "at-risk") return "at-risk";
  if (status === "blocked") return "blocked";
  if (status === "awaiting-client") return "scheduled"; // pale; work paused on client
  return "active";
}

// ── Daily gridlines ───────────────────────────────────────
// Render a faint vertical line per day inside the timeline track. Mondays
// get a slightly darker line so weeks are visually distinguishable even
// when daily ticks are dense. Skip for monthly axes (too many lines).

const MS_PER_DAY_LOCAL = 24 * 60 * 60 * 1000;

function eachDayBetween(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  for (let t = start.getTime(); t < end.getTime(); t += MS_PER_DAY_LOCAL) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function GridLines({ axis }: { axis: AxisParams }): JSX.Element | null {
  if (axis.kind !== "weekly") return null; // monthly = too noisy with daily lines
  const totalDays = dayDiff(axis.start, axis.end);
  if (totalDays <= 0) return null;
  const days = eachDayBetween(axis.start, axis.end);
  return (
    <>
      {days.map((iso) => {
        const d = new Date(`${iso}T00:00:00Z`);
        const isMonday = d.getUTCDay() === 1;
        const left = clampPct((dayDiff(axis.start, iso) / totalDays) * 100);
        return (
          <div
            key={iso}
            className={`grid-line ${isMonday ? "major" : ""}`.trim()}
            style={{ left: `${left}%` }}
          />
        );
      })}
    </>
  );
}

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Returns the lowercase weekday name for an ISO date string (YYYY-MM-DD).
 * Parses as UTC midnight to avoid local-timezone day-shift.
 * Used to populate `data-day` on axis-cell divs so container-query CSS can
 * selectively hide Thursday ticks at ≤1300px and non-Monday ticks at ≤900px.
 */
function getDayName(dateStr: string): string {
  return WEEKDAY_NAMES[parseISO(dateStr).getUTCDay()];
}

function AxisRow({ axis }: { axis: AxisParams }): JSX.Element | null {
  if (axis.kind === "no-axis") return null;
  const totalDays = dayDiff(axis.start, axis.end);
  return (
    <div className="axis-row">
      <div className="axis-spacer" />
      <div className="axis-cells">
        {axis.columns.map((col) => {
          const colLeft = clampPct((dayDiff(axis.start, col.date) / totalDays) * 100);
          return (
            <div
              key={col.date}
              className="axis-cell"
              data-day={getDayName(col.date)}
              style={{ left: `${colLeft}%` }}
            >
              {col.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────

/**
 * Body-only render of one Gantt's data integrity panel + rows. Used by
 * both the standalone GanttTemplate (one-section page) and the
 * RundownTemplate (multi-section page) so the rendering logic stays in
 * one place.
 *
 * Band order: SectionLegend → DataIntegrityPanel (if enabled) → AxisRow →
 * rows → AxisRow (repeat at bottom).
 */
export function GanttSection({ data, theme }: { data: GanttData; theme: Theme }): JSX.Element {
  const { raw, rows, axis, summary } = data;
  const todayPct = computeTodayPosition(axis);
  const tokens = getThemeTokens(theme);
  return (
    <>
      <SectionLegend theme={theme} />
      {tokens.chrome.showDataIntegrityPanel && (
        <DataIntegrityPanel summary={summary} isWrapper={raw.kind === "wrapper"} />
      )}
      <section className="body">
        {axis.kind === "no-axis" && (
          <div className="no-axis-note">
            No dates available — body rendered without a timeline.
          </div>
        )}
        {axis.kind !== "no-axis" && <AxisRow axis={axis} />}

        {rows.map((row) => (
          <RowBlock key={row.id} row={row} axis={axis} todayPct={todayPct} theme={theme} />
        ))}

        {/* Repeat axis at bottom — operator (2026-04-30) wants dates
            visible after scrolling through long row lists. */}
        {axis.kind !== "no-axis" && rows.length > 0 && <AxisRow axis={axis} />}
      </section>
    </>
  );
}

export function GanttTemplate({ data, theme = "light-internal" }: { data: GanttData; theme?: Theme }): JSX.Element {
  const { raw, headerRange, generatedAt } = data;
  const tokens = getThemeTokens(theme);
  const styles = theme === "light-branded" ? STYLES_BRANDED : STYLES;

  return (
    <html lang="en">
      {/* eslint-disable-next-line @next/next/no-head-element -- standalone HTML doc, not a Next.js page */}
      <head>
        <meta charSet="utf-8" />
        <title>{`Gantt — ${raw.client.name}: ${raw.entity.name}`}</title>
        {theme !== "dark-account-view" && <style dangerouslySetInnerHTML={{ __html: styles }} />}
      </head>
      <body>
        <div className="gantt">
          <header className="header">
            {tokens.chrome.useBrandedHeader ? (
              <>
                <div className="header-text">
                  <h1>
                    {raw.client.name}: {raw.entity.name}{" "}
                    <span style={{ fontSize: "12px", fontWeight: 400, color: "#333" }}>
                      ({chartLabel(data)})
                    </span>
                  </h1>
                  <div className="meta">
                    <span>{headerRange}</span>
                    <span> · Generated {generatedAt}</span>
                  </div>
                </div>
                {tokens.chrome.showLogo && tokens.logo.dataUri && (
                  // eslint-disable-next-line @next/next/no-img-element -- standalone HTML doc, not a Next.js page
                  <img
                    src={tokens.logo.dataUri}
                    alt={tokens.logo.altText}
                    className="header-logo"
                  />
                )}
              </>
            ) : (
              <>
                <h1>
                  {raw.client.name}: {raw.entity.name}{" "}
                  <span style={{ fontSize: "12px", fontWeight: 400, color: "#888" }}>
                    ({chartLabel(data)})
                  </span>
                </h1>
                <div className="meta">
                  <span>{headerRange}</span>
                  <span> · Generated {generatedAt}</span>
                </div>
              </>
            )}
          </header>

          <GanttSection data={data} theme={theme} />
        </div>
      </body>
    </html>
  );
}

function RowBlock({
  row,
  axis,
  todayPct,
  theme,
}: {
  row: AnnotatedRow;
  axis: AxisParams;
  todayPct: number | null;
  theme: Theme;
}): JSX.Element {
  const tokens = getThemeTokens(theme);
  const geom = computeBarGeometry(row, axis);
  const showTodayLine = todayPct !== null && axis.kind !== "no-axis";
  const allRowIssues = [...row.inline, ...row.subRow];
  const rowSeverity = highestSeverity(allRowIssues);
  return (
    <>
      <div className={rowClass(row)} data-row-kind={row.kind}>
        <div className="title">
          {row.title}
          {tokens.chrome.showRowAlerts && row.subRow.length > 0 && rowSeverity && (
            <span className={`alert-badge ${rowSeverity}`}>⚠</span>
          )}
        </div>
        <div className="meta">{metaLine(row)}</div>
        <div className={inlineDateClass(row)}>
          <DateOrNull value={row.startDate} />
          <span> – </span>
          <DateOrNull value={row.endDate} />
        </div>
        <div className="timeline">
          <GridLines axis={axis} />
          {axis.kind !== "no-axis" && showTodayLine && (
            <div className="today-line" style={{ left: `${todayPct}%` }} />
          )}
          {geom.kind === "bar" && (
            <div
              className={`bar ${statusClass(row)}`}
              style={{ left: `${geom.left}%`, width: `${geom.width}%` }}
            />
          )}
          {geom.kind === "milestone" && (
            <div
              className={`milestone ${statusClass(row)}`}
              style={{ left: `${geom.left}%` }}
            />
          )}
        </div>
      </div>
      {tokens.chrome.showRowAlerts && row.subRow.length > 0 && (
        <div className={`sub-row ${highestSeverity(row.subRow) ?? "warn"}`}>
          {row.subRow.map((issue: Issue, idx: number) => (
            <span key={`${issue.code}-${idx}`} className="alert-line">
              <code>{issue.code}</code> — {issue.message}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// ── Client rundown ────────────────────────────────────────

function overallSeverityClass(s: SeverityCounts): string {
  if (s.critical > 0) return "rundown-overall critical";
  if (s.warn > 0 || s.info > 0) return "rundown-overall warn";
  return "rundown-overall clean";
}

function topSeverityEmoji(s: SeverityCounts): string {
  if (s.critical > 0) return "🔴";
  if (s.warn > 0) return "🟡";
  if (s.info > 0) return "🔵";
  return "✅";
}

function severityCountsLabel(s: SeverityCounts): string {
  if (s.critical + s.warn + s.info === 0) return "clean";
  const parts: string[] = [];
  if (s.critical > 0) parts.push(`${s.critical} critical`);
  if (s.warn > 0) parts.push(`${s.warn} warn`);
  if (s.info > 0) parts.push(`${s.info} info`);
  return parts.join(" · ");
}

function tocTallyClass(s: SeverityCounts): string {
  if (s.critical > 0) return "toc-tally critical";
  if (s.warn > 0 || s.info > 0) return "toc-tally warn";
  return "toc-tally clean";
}

type TocBlock =
  | { kind: "wrapper"; wrapper: RundownSection; children: RundownSection[] }
  | { kind: "standalone"; section: RundownSection };

/**
 * Group sections so each wrapper gets bundled with its child drill-ins
 * for the TOC card layout. Standalones become their own one-line card.
 */
function groupTocSections(sections: RundownSection[]): TocBlock[] {
  const blocks: TocBlock[] = [];
  let currentWrapper: { wrapper: RundownSection; children: RundownSection[] } | null = null;
  for (const s of sections) {
    if (s.kind === "wrapper") {
      if (currentWrapper) blocks.push({ kind: "wrapper", ...currentWrapper });
      currentWrapper = { wrapper: s, children: [] };
    } else if (s.kind === "wrapper-child") {
      if (currentWrapper) {
        currentWrapper.children.push(s);
      } else {
        // Defensive — shouldn't happen with current rundown ordering.
        blocks.push({ kind: "standalone", section: s });
      }
    } else {
      if (currentWrapper) {
        blocks.push({ kind: "wrapper", ...currentWrapper });
        currentWrapper = null;
      }
      blocks.push({ kind: "standalone", section: s });
    }
  }
  if (currentWrapper) blocks.push({ kind: "wrapper", ...currentWrapper });
  return blocks;
}

function TocLink({ section }: { section: RundownSection }): JSX.Element {
  const sev = section.data.summary.severity;
  return (
    <>
      <span className="toc-emoji" aria-hidden="true">
        {topSeverityEmoji(sev)}
      </span>
      <a href={`#${section.anchor}`}>{section.title}</a>
      <span className={tocTallyClass(sev)}>{severityCountsLabel(sev)}</span>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- theme reserved for future TOC theming
function RundownToc({ sections, theme }: { sections: RundownSection[]; theme: Theme }): JSX.Element {
  const blocks = groupTocSections(sections);
  return (
    <nav className="rundown-toc">
      <h2>Sections</h2>
      <div className="toc-grid">
        {blocks.map((block) => {
          if (block.kind === "wrapper") {
            return (
              <div key={block.wrapper.anchor} className="toc-block wrapper">
                <div className="toc-block-head">
                  <TocLink section={block.wrapper} />
                </div>
                {block.children.length > 0 && (
                  <ul className="toc-children">
                    {block.children.map((c) => (
                      <li key={c.anchor}>
                        <TocLink section={c} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          }
          return (
            <div key={block.section.anchor} className="toc-block">
              <div className="toc-block-head">
                <TocLink section={block.section} />
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function kindTag(kind: RundownSection["kind"]): string {
  if (kind === "wrapper") return "Wrapper";
  if (kind === "wrapper-child") return "Sub-project";
  return "L1";
}

export function SectionBlock({ section, theme }: { section: RundownSection; theme: Theme }): JSX.Element {
  const { data } = section;
  return (
    <article id={section.anchor} className="rundown-section">
      <header className="section-head">
        <h2>
          {section.title}
          <span className={`kind-tag ${section.kind}`}>{kindTag(section.kind)}</span>
        </h2>
        <div className="meta">
          {section.parentTitle ? <span>under {section.parentTitle} · </span> : null}
          <span>{data.headerRange}</span>
        </div>
      </header>
      <GanttSection data={data} theme={theme} />
    </article>
  );
}

export function RundownTemplate({ data, theme = "light-internal" }: { data: ClientRundownData; theme?: Theme }): JSX.Element {
  const { client, sections, generatedAt, overallSeverity } = data;
  const tokens = getThemeTokens(theme);
  const styles = theme === "light-branded" ? STYLES_BRANDED : STYLES;

  return (
    <html lang="en">
      {/* eslint-disable-next-line @next/next/no-head-element -- standalone HTML doc, not a Next.js page */}
      <head>
        <meta charSet="utf-8" />
        <title>{`Rundown — ${client.name}`}</title>
        {theme !== "dark-account-view" && <style dangerouslySetInnerHTML={{ __html: styles }} />}
      </head>
      <body>
        <div className="gantt">
          <header className="rundown-head">
            {tokens.chrome.useBrandedHeader ? (
              <>
                <div className="rundown-head-text">
                  <h1>{client.name} — Rundown</h1>
                  <div className="meta">
                    <span>
                      {sections.length} section{sections.length === 1 ? "" : "s"}
                    </span>
                    <span> · Generated {generatedAt}</span>
                  </div>
                </div>
                {tokens.chrome.showLogo && tokens.logo.dataUri && (
                  // eslint-disable-next-line @next/next/no-img-element -- standalone HTML doc, not a Next.js page
                  <img
                    src={tokens.logo.dataUri}
                    alt={tokens.logo.altText}
                    className="header-logo"
                  />
                )}
              </>
            ) : (
              <>
                <h1>{client.name} — Rundown</h1>
                <div className="meta">
                  <span>
                    {sections.length} section{sections.length === 1 ? "" : "s"}
                  </span>
                  <span> · Generated {generatedAt}</span>
                </div>
                <div className={overallSeverityClass(overallSeverity)}>
                  <span aria-hidden="true">{topSeverityEmoji(overallSeverity)}</span>{" "}
                  {severityCountsLabel(overallSeverity)} across all sections
                </div>
              </>
            )}
          </header>

          <RundownToc sections={sections} theme={theme} />

          {sections.map((s) => (
            <SectionBlock key={s.anchor} section={s} theme={theme} />
          ))}
        </div>
      </body>
    </html>
  );
}

export { GanttTemplate as default };

/** Render the full HTML document for one Gantt. */
export function renderGantt(data: GanttData, theme: Theme = "light-internal"): string {
  return "<!doctype html>" + renderToStaticMarkup(<GanttTemplate data={data} theme={theme} />);
}

/** Render a single-page rundown HTML document for an entire client. */
export function renderClientRundown(data: ClientRundownData, theme: Theme = "light-internal"): string {
  return "<!doctype html>" + renderToStaticMarkup(<RundownTemplate data={data} theme={theme} />);
}
