/**
 * Self-contained dark-account-view GanttSection renderer.
 *
 * WHY THIS FILE EXISTS:
 * GanttTemplate.tsx imports react-dom/server and themes.ts imports Node's fs.
 * Next.js 16 + Turbopack prohibits ANY file in a App Router entrypoint's
 * static import graph from importing react-dom/server or fs. This restriction
 * applies to route handlers and server components alike — even when those
 * imports are only used in unrelated export paths (e.g. renderGantt).
 *
 * This file extracts exactly the components GanttSection uses when
 * theme === "dark-account-view", with:
 *   - No react-dom/server import
 *   - No themes.ts import (no fs)
 *   - Dark chrome hardcoded: showDataIntegrityPanel=false, showRowAlerts=false
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

function DateOrNull({ value }: { value: string | null }): JSX.Element {
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

function GridLines({ axis }: { axis: AxisParams }): JSX.Element | null {
  if (axis.kind !== "weekly") return null;
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

// ── Legend (dark variant) ───────────────────────────────���─

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
        <span className="inline-block w-7 h-3 rounded-sm bg-slate-400" />{" "}
        <span className="line-through opacity-60">canceled</span>
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
}): JSX.Element {
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

export function GanttSectionDark({ data }: { data: GanttData }): JSX.Element {
  const { rows, axis } = data;
  const todayPct = computeTodayPosition(axis);
  return (
    <>
      <SectionLegendDark />
      {/* showDataIntegrityPanel=false for dark-account-view */}
      <section className="body">
        {axis.kind === "no-axis" && (
          <div className="no-axis-note">
            No dates available — body rendered without a timeline.
          </div>
        )}
        {axis.kind !== "no-axis" && <AxisRow axis={axis} />}

        {rows.map((row) => (
          <RowBlock key={row.id} row={row} axis={axis} todayPct={todayPct} />
        ))}
      </section>
    </>
  );
}
