"use client";

import { useMemo } from "react";
import type { DayItem, DayItemEntry } from "../types";
import { DayItemCard } from "./day-item-card";
import { filterInFlight } from "@/lib/runway/plate-summary";

interface InFlightSectionProps {
  /** All current and upcoming week items (board's combined source). */
  weekItems: DayItem[];
  /** ISO date to treat as "today". Optional override for tests. */
  nowISO?: string;
  /** When false, the section collapses to null. Toggle lives in header. */
  enabled: boolean;
}

/**
 * In Flight — Chunk 3 #6. Surfaces every L2 whose status is in-progress AND
 * today falls between its start/end dates. Placed between Red (Needs Update)
 * and Today in the Week Of layout to answer the question "what's actively
 * moving right now?" at a glance.
 */
export function InFlightSection({ weekItems, nowISO, enabled }: InFlightSectionProps) {
  // Chunk 5 debt §13.2: derive `today` inside the memo instead of on every
  // render. Without this the `new Date()` call (when `nowISO` is undefined)
  // produces a fresh string each render — primitive-equal in practice, but
  // the allocation is still wasted work and obscures the dependency array.
  const inFlight = useMemo<DayItemEntry[]>(() => {
    if (!enabled) return [];
    const today = nowISO ?? new Date().toISOString().slice(0, 10);
    const all = weekItems.flatMap((day) => day.items);
    return filterInFlight(all, today);
  }, [enabled, weekItems, nowISO]);

  if (!enabled) return null;
  if (inFlight.length === 0) return null;

  return (
    <section data-testid="in-flight-section">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold text-sky-300">
          In Flight
        </h2>
        <span className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-sm font-medium text-sky-200">
          {inFlight.length}
        </span>
      </div>
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
    </section>
  );
}
