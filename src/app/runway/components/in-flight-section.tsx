"use client";

import { useMemo } from "react";
import type { DayItem, DayItemEntry } from "../types";
import { DayItemCard } from "./day-item-card";
import { InFlightToggle } from "./in-flight-toggle";
import { filterInFlight } from "@/lib/runway/plate-summary";

interface InFlightSectionProps {
  /** All current and upcoming week items (board's combined source). */
  weekItems: DayItem[];
  /** ISO date to treat as "today". Optional override for tests. */
  nowISO?: string;
  /** When false, the section collapses to null. Toggle lives in header. */
  enabled: boolean;
  /**
   * Toggle props -- when provided, the section header renders the toggle
   * inline so the control and heading are in the same row.
   * Required for dashboard-cleanup item 3: "In Flight (7) [Toggle]" layout.
   */
  onToggle?: (next: boolean) => Promise<unknown>;
  onToggleChange?: (next: boolean) => void;
}

/**
 * In Flight -- dashboard view. Surfaces every L2 whose status is in-progress
 * AND today falls between its start/end dates. Placed between Red (Needs
 * Update) and Today in the Week Of layout to answer the question "what's
 * actively moving right now?" at a glance.
 *
 * Dashboard cleanup item 3: the toggle is now rendered inline in the section
 * header instead of as a standalone control above the section. Shape:
 *   In Flight  (7)  [toggle]
 * The section renders its header even when disabled so the user can re-enable
 * without hunting for the toggle above the fold.
 */
export function InFlightSection({
  weekItems,
  nowISO,
  enabled,
  onToggle,
  onToggleChange,
}: InFlightSectionProps) {
  // Derive `today` inside the memo instead of on every render. Without this
  // the `new Date()` call (when `nowISO` is undefined) produces a fresh string
  // each render -- primitive-equal in practice, but the allocation is still
  // wasted work and obscures the dependency array.
  // Compute the in-flight set regardless of `enabled` so the count badge
  // can stay visible when the section is toggled off (operator-locked
  // 2026-05-07: users want to know what's hidden by the toggle).
  const inFlight = useMemo<DayItemEntry[]>(() => {
    const today = nowISO ?? new Date().toISOString().slice(0, 10);
    const all = weekItems.flatMap((day) => day.items);
    return filterInFlight(all, today);
  }, [weekItems, nowISO]);

  // When no toggle props are provided, fall back to legacy behavior:
  // hide entirely when disabled or when there are no items. This preserves
  // back-compat for tests that don't pass toggle props.
  const hasToggle = onToggle !== undefined;

  if (!hasToggle && !enabled) return null;
  if (!hasToggle && inFlight.length === 0) return null;

  return (
    <section data-testid="in-flight-section">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-display text-2xl font-bold text-sky-300">
          In Flight
        </h2>
        {inFlight.length > 0 ? (
          <span
            data-testid="in-flight-count"
            className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-sm font-medium text-sky-200"
          >
            {inFlight.length}
          </span>
        ) : null}
        {hasToggle ? (
          <span className="ml-1">
            <InFlightToggle
              initialEnabled={enabled}
              onToggle={onToggle}
              onChange={onToggleChange}
              compact
            />
          </span>
        ) : null}
      </div>
      {enabled && inFlight.length > 0 ? (
        <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 sm:p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inFlight.map((item, i) => (
              <DayItemCard
                key={`inflight-${item.id ?? item.title.slice(0, 20)}-${i}`}
                item={item}
                size="sm"
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
