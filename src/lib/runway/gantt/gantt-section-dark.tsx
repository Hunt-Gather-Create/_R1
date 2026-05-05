/**
 * Self-contained dark-account-view GanttSection renderer used exclusively by
 * RundownContentRSC (src/app/runway/components/rundown-content-rsc.tsx) and
 * the gantt-embed route handler (src/app/api/runway/gantt-embed/route.ts).
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM GanttSection IN GanttTemplate.tsx:
 * Even with the canonical `require("react-dom/server")` workaround in
 * GanttTemplate.tsx (which dodges Turbopack's static analyzer for the
 * react-dom/server wall), importing `GanttSection` into an RSC chain still
 * pulls in themes.ts. themes.ts calls `fs.readFileSync` at module init to
 * inline the CIV logo as a base64 data URI — Turbopack's static analyzer
 * traces `fs` in App Router paths and walls the build the same way it walls
 * `react-dom/server`. Keeping a parallel dark-only renderer here avoids the
 * fs chain entirely.
 *
 * This file extracts exactly the components GanttSection uses when
 * theme === "dark-account-view", with:
 *   - No react-dom/server import
 *   - No themes.ts import (no fs)
 *   - Dark chrome hardcoded: showDataIntegrityPanel=false, showRowAlerts=false
 *
 * DO NOT delete this file or replace it with `<GanttSection theme="dark-
 * account-view" />` without first verifying that RundownContentRSC + page.tsx
 * + the gantt-embed route handler all still build cleanly under Turbopack.
 *
 * Keep in sync with GanttTemplate.tsx: GanttSection, RowBlock, AxisRow,
 * SectionLegendDark, GridLines, computeBarGeometry, computeTodayPosition,
 * and the helper functions they call. When GanttTemplate.tsx changes its
 * rendering logic for the dark theme, mirror those changes here.
 */

import * as React from "react";
import type {
  AnnotatedRow,
  AxisParams,
  GanttData,
  RundownSection,
} from "./types";

// ── Geometry helpers ─────────────���─────────────────────────

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

// ── Helpers ─────────────────────────────���──────────────────

function numericDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
}

function DateOrNull({ value }: { value: string | null }): React.JSX.Element {
  if (value === null) return <span className="null">null</span>;
  return <span>{numericDate(value)}</span>;
}

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

function statusClass(row: AnnotatedRow): string {
  const status = row.status ?? "scheduled";
  if (status === "scheduled" || status === "not-started" || status === "on-hold") {
    return "scheduled";
  }
  if (status === "at-risk") return "at-risk";
  if (status === "blocked") return "blocked";
  if (status === "completed") return "completed";
  if (status === "canceled") return "canceled";
  if (status === "awaiting-client") return "scheduled";
  return "active";
}

// ── Day name for data-day attribute ───────────────────────

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function getDayName(dateStr: string): string {
  return WEEKDAY_NAMES[parseISO(dateStr).getUTCDay()];
}

// ── Gridlines ─────────────────────────────────────────────

function eachDayBetween(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  for (let t = start.getTime(); t < end.getTime(); t += MS_PER_DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function GridLines({ axis }: { axis: AxisParams }): React.JSX.Element | null {
  // Daily + weekly tiers paint per-day vertical lines (Mondays slightly
  // darker for week-distinguishing). Monthly tier skips them — at >8wk
  // spans the daily lines crash visually. Operator-locked 2026-05-05.
  if (axis.kind !== "daily" && axis.kind !== "weekly") return null;
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

// ── Axis row ───────────────────────────────��──────────────

/**
 * Two-row axis (operator-locked 2026-05-05): month-band header above tick
 * row. Mirrors GanttTemplate.tsx AxisRow + MonthBandRow. Bands are calendar
 * month names (no year). CSS in gantt-dark-embed.module.css paints the
 * `.axis-row.month-band` and `.axis-cell.month-band-cell` selectors.
 */
function MonthBandRow({ axis }: { axis: AxisParams }): React.JSX.Element | null {
  if (axis.kind === "no-axis") return null;
  if (axis.monthBands.length === 0) return null;
  const totalDays = dayDiff(axis.start, axis.end);
  if (totalDays <= 0) return null;
  return (
    <div className="axis-row month-band">
      <div className="axis-spacer" />
      <div className="axis-cells">
        {axis.monthBands.map((band) => {
          const startCol = axis.columns[band.startCol];
          const endCol = axis.columns[band.endCol];
          if (!startCol || !endCol) return null;
          const left = clampPct((dayDiff(axis.start, startCol.date) / totalDays) * 100);
          const nextCol = axis.columns[band.endCol + 1];
          const right = nextCol
            ? clampPct((dayDiff(axis.start, nextCol.date) / totalDays) * 100)
            : 100;
          const width = Math.max(0, right - left);
          return (
            <div
              key={`${band.label}-${band.startCol}`}
              className="axis-cell month-band-cell"
              data-cols={`${band.startCol},${band.endCol}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              {band.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AxisRow({ axis }: { axis: AxisParams }): React.JSX.Element | null {
  if (axis.kind === "no-axis") return null;
  const totalDays = dayDiff(axis.start, axis.end);
  return (
    <>
      <MonthBandRow axis={axis} />
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
    </>
  );
}

// ── Legend (dark variant) ───────────────────────────────���─

/**
 * Dark-account-view legend. Swatches use the `.legend-swatch[data-status]`
 * selectors defined in gantt-dark-embed.module.css which paint byte-identical
 * values to the `.bar.{status}` rules — guarantees pixel parity between the
 * legend and the chart bars (operator-flagged 2026-05-04).
 *
 * The `flex flex-wrap gap-3 items-center text-xs text-slate-400 mb-3`
 * Tailwind layout duplicates `.section-legend` rules from the CSS module
 * (which is scoped under .darkEmbed) so the legend reads consistently with
 * the rest of the embed even before the module rules cascade.
 */
function SectionLegendDark(): React.JSX.Element {
  return (
    <div className="section-legend flex flex-wrap gap-3 items-center text-xs text-slate-400 mb-3">
      <span className="legend-item inline-flex items-center gap-1.5">
        <span className="legend-swatch inline-block w-7 h-3 rounded-md" data-status="in-progress" /> in-progress
      </span>
      <span className="legend-item inline-flex items-center gap-1.5">
        <span className="legend-swatch inline-block w-7 h-3 rounded-md" data-status="scheduled" /> scheduled
      </span>
      <span className="legend-item inline-flex items-center gap-1.5">
        <span className="legend-swatch inline-block w-7 h-3 rounded-md" data-status="at-risk" /> at-risk
      </span>
      <span className="legend-item inline-flex items-center gap-1.5">
        <span className="legend-swatch inline-block w-7 h-3 rounded-md" data-status="blocked" /> blocked
      </span>
      <span className="legend-item inline-flex items-center gap-1.5">
        <span className="legend-swatch inline-block w-7 h-3 rounded-md" data-status="completed" /> completed
      </span>
      <span className="legend-item inline-flex items-center gap-1.5">
        <span className="legend-swatch inline-block w-7 h-3 rounded-md" data-status="canceled" />{" "}
        <span className="line-through opacity-60">canceled</span>
      </span>
      <span className="legend-item inline-flex items-center gap-1.5">
        <span
          className="inline-block w-3 h-3 bg-blue-500/70"
          style={{ transform: "rotate(45deg)" }}
          aria-hidden="true"
        />{" "}
        milestone
      </span>
    </div>
  );
}

// ── Row block ─────────────────────────────────────────────
// Dark chrome: showRowAlerts=false — no alert badges or sub-rows.

function RowBlock({
  row,
  axis,
  todayPct,
}: {
  row: AnnotatedRow;
  axis: AxisParams;
  todayPct: number | null;
}): React.JSX.Element {
  const geom = computeBarGeometry(row, axis);
  const showTodayLine = todayPct !== null && axis.kind !== "no-axis";
  return (
    <>
      <div className={rowClass(row)} data-row-kind={row.kind}>
        <div className="title">{row.title}</div>
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
      {/* showRowAlerts=false for dark-account-view — no sub-row alerts */}
    </>
  );
}

// ── GanttSectionDark ──────────────────────────��───────────
// Dark-specific GanttSection: no DataIntegrityPanel, no row alerts.
// Mirrors GanttSection in GanttTemplate.tsx for theme="dark-account-view".

export function GanttSectionDark({
  data,
  sectionKind,
}: {
  data: GanttData;
  sectionKind?: RundownSection["kind"];
}): React.JSX.Element {
  const { rows, axis } = data;
  const todayPct = computeTodayPosition(axis);
  // Operator-locked 2026-05-04: wrapper-child sub-projects do NOT render
  // their own legend or axis row. Only top-level subjects (wrapper +
  // standalone L1) anchor those. See GanttSection in GanttTemplate.tsx for
  // the matching rule on light themes.
  const isWrapperChild = sectionKind === "wrapper-child";
  // Issue 1 (operator-locked 2026-05-05): empty top-level subjects suppress
  // axis chrome — the section legend + title still render but the
  // month-band + tick row do not, since there is no body to plot against
  // them. Mirrors GanttSection in GanttTemplate.tsx.
  const hasRows = rows.length > 0;
  return (
    <>
      {!isWrapperChild && <SectionLegendDark />}
      {/* showDataIntegrityPanel=false for dark-account-view */}
      <section className="body">
        {axis.kind === "no-axis" && (
          <div className="no-axis-note">
            No dates available — body rendered without a timeline.
          </div>
        )}
        {axis.kind !== "no-axis" && !isWrapperChild && hasRows && <AxisRow axis={axis} />}

        {rows.map((row) => (
          <RowBlock key={row.id} row={row} axis={axis} todayPct={todayPct} />
        ))}
      </section>
    </>
  );
}
