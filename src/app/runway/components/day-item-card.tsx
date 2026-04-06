"use client";

import type { DayItemEntry, DayItemType } from "../types";
import { TYPE_INDICATORS } from "./status-badge";

const HOLD_PATTERN = /\b(hold[s]?\s+until|on\s+hold|blocked|not\s+starting\s+until)\b/i;

/**
 * Override the display type to "blocked" if notes contain hold/blocked language.
 */
export function getEffectiveType(item: DayItemEntry): DayItemType {
  if (item.type === "blocked") return "blocked";
  if (item.notes && HOLD_PATTERN.test(item.notes)) return "blocked";
  return item.type;
}

interface DayItemCardProps {
  item: DayItemEntry;
  size?: "sm" | "lg";
}

const ACCOUNT_CLASS = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const SIZE_CLASSES = {
  sm: {
    card: "rounded-lg border border-border/50 bg-background/50 p-3",
    title: "mt-0.5 text-sm font-medium leading-snug text-foreground",
    meta: "mt-1 flex flex-wrap items-center gap-2",
    metaText: "text-xs text-muted-foreground",
    notes: "mt-1 text-xs text-muted-foreground/70",
    gap: "gap-2",
  },
  lg: {
    card: "rounded-xl border border-sky-500/30 bg-sky-500/5 p-4",
    title: "mt-0.5 text-base font-medium leading-snug text-foreground",
    meta: "mt-2 flex flex-wrap items-center gap-2",
    metaText: "text-sm text-muted-foreground",
    notes: "mt-2 text-sm text-muted-foreground/70",
    gap: "gap-3",
  },
} as const;

export function DayItemCard({ item, size = "sm" }: DayItemCardProps) {
  const s = SIZE_CLASSES[size];
  const displayType = getEffectiveType(item);

  return (
    <div className={s.card}>
      <div className={`flex items-start justify-between ${s.gap}`}>
        <div className="min-w-0 flex-1">
          <p className={ACCOUNT_CLASS}>{item.account}</p>
          <p className={s.title}>{item.title}</p>
          {item.owner ? (
            <div className={s.meta}>
              <span className={s.metaText}>{item.owner}</span>
            </div>
          ) : null}
          {item.notes ? <p className={s.notes}>{item.notes}</p> : null}
        </div>
        <span
          className={`mt-0.5 shrink-0 text-xs font-medium uppercase tracking-wider ${
            TYPE_INDICATORS[displayType] ?? "text-muted-foreground"
          }`}
        >
          {displayType}
        </span>
      </div>
    </div>
  );
}
