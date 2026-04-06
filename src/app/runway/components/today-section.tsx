"use client";

import { useMemo } from "react";
import type { DayItem } from "../types";
import { DayItemCard } from "./day-item-card";

export function TodaySection({
  todayColumn,
}: {
  todayColumn: DayItem | null;
}) {
  const todayFormatted = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    []
  );

  return (
    <section>
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-display text-2xl font-bold text-foreground">
          Today
        </h2>
        <span className="text-base text-muted-foreground">{todayFormatted}</span>
      </div>
      {todayColumn && todayColumn.items.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {todayColumn.items.map((item, i) => (
            <DayItemCard
              key={`today-${item.title.slice(0, 20)}-${i}`}
              item={item}
              size="lg"
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
