"use client";

import type { DayItemEntry } from "../types";
import { TYPE_INDICATORS } from "./status-badge";

interface DayItemCardProps {
  item: DayItemEntry;
  size?: "sm" | "lg";
}

const SIZE_CLASSES = {
  sm: {
    card: "rounded-lg border border-border/50 bg-background/50 p-3",
    title: "text-sm font-medium leading-snug text-foreground",
    meta: "mt-1 flex flex-wrap items-center gap-2",
    metaText: "text-xs text-muted-foreground",
    separator: "text-xs text-muted-foreground/50",
    notes: "mt-1 text-xs text-muted-foreground/70",
    gap: "gap-2",
  },
  lg: {
    card: "rounded-xl border border-sky-500/30 bg-sky-500/5 p-4",
    title: "text-base font-medium leading-snug text-foreground",
    meta: "mt-2 flex flex-wrap items-center gap-2",
    metaText: "text-sm text-muted-foreground",
    separator: "text-muted-foreground/40",
    notes: "mt-2 text-sm text-muted-foreground/70",
    gap: "gap-3",
  },
} as const;

export function DayItemCard({ item, size = "sm" }: DayItemCardProps) {
  const s = SIZE_CLASSES[size];

  return (
    <div className={s.card}>
      <div className={`flex items-start justify-between ${s.gap}`}>
        <div className="min-w-0 flex-1">
          <p className={s.title}>{item.title}</p>
          <div className={s.meta}>
            <span className={s.metaText}>{item.account}</span>
            {item.owner ? (
              <>
                <span className={s.separator}>/</span>
                <span className={s.metaText}>{item.owner}</span>
              </>
            ) : null}
          </div>
          {item.notes ? <p className={s.notes}>{item.notes}</p> : null}
        </div>
        <span
          className={`mt-0.5 shrink-0 text-xs font-medium uppercase tracking-wider ${
            TYPE_INDICATORS[item.type] ?? "text-muted-foreground"
          }`}
        >
          {item.type}
        </span>
      </div>
    </div>
  );
}
