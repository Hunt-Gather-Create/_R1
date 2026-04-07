"use client";

import type { DayItem } from "../types";
import { DayItemCard } from "./day-item-card";

interface NeedsUpdateSectionProps {
  staleItems: DayItem[];
}

export function NeedsUpdateSection({ staleItems }: NeedsUpdateSectionProps) {
  const totalCount = staleItems.reduce((sum, day) => sum + day.items.length, 0);
  if (totalCount === 0) return null;

  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold text-red-400">
          Needs Update
        </h2>
        <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-sm font-medium text-red-300">
          {totalCount}
        </span>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        These items haven&apos;t been updated. DM the bot to clear them.
      </p>
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 sm:p-4">
        <div className="space-y-4">
          {staleItems.map((day) => (
            <div key={day.date}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {day.label}
              </p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {day.items.map((item, i) => (
                  <DayItemCard
                    key={`stale-${day.date}-${item.title.slice(0, 20)}-${i}`}
                    item={item}
                    size="lg"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
