import * as React from "react";

/**
 * Section-level chips that surface on BOTH the By Account tab (light variant)
 * AND the Gantt Charts dark embed (dark variant). Centralized here so the
 * two surfaces cannot drift -- any rule change to chip behavior lands in
 * one file and propagates to both consumers.
 *
 * - Ready to close?: L1 has every weekItem completed (or 0 weekItems with a
 *   past endDate per Branch B). Manual close-out nudge.
 * - No Scheduled Tasks: L1 has 0 weekItems. Surfaces the absence of a
 *   breakdown so the L1 doesn't read as "missing" rather than "no L2s yet".
 * - All Done: L1 has weekItems and every one is completed or canceled.
 *   Refs _R1#105. Distinct from No Scheduled Tasks, which means there was
 *   never a breakdown at all. All Done and Ready to close? are not a
 *   contradiction, they can both render on the same L1 at once.
 */

type ChipVariant = "light" | "dark";

const READY_TO_CLOSE_STYLES: Record<ChipVariant, string> = {
  light: "rounded px-1.5 py-0.5 normal-case bg-amber-500/20 text-amber-400",
  dark: "ml-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-amber-300",
};

const NO_SCHEDULED_STYLES: Record<ChipVariant, string> = {
  light: "rounded px-1.5 py-0.5 bg-muted text-muted-foreground",
  dark: "ml-2 rounded-full border border-slate-600 bg-slate-700/50 px-2 py-0.5 text-slate-300",
};

const ALL_DONE_STYLES: Record<ChipVariant, string> = {
  light: "rounded px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400",
  dark: "ml-2 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-emerald-300",
};

const TYPOGRAPHY = "inline-flex items-center text-[10px] font-medium uppercase tracking-wide";

export function ReadyToCloseChip({ variant = "light" }: { variant?: ChipVariant }) {
  return (
    <span
      data-testid="ready-to-close-chip"
      className={`${TYPOGRAPHY} ${READY_TO_CLOSE_STYLES[variant]}`}
    >
      Ready to close?
    </span>
  );
}

export function NoScheduledTasksChip({ variant = "light" }: { variant?: ChipVariant }) {
  return (
    <span
      data-testid="no-scheduled-tasks-chip"
      className={`${TYPOGRAPHY} ${NO_SCHEDULED_STYLES[variant]}`}
    >
      No Scheduled Tasks
    </span>
  );
}

export function AllDoneChip({ variant = "light" }: { variant?: ChipVariant }) {
  return (
    <span
      data-testid="all-done-chip"
      className={`${TYPOGRAPHY} ${ALL_DONE_STYLES[variant]}`}
    >
      All Done
    </span>
  );
}
