"use client";

import type { DayItem } from "../types";
import { DayItemCard } from "./day-item-card";

export function DayColumn({
  day,
  isToday = false,
}: {
  day: DayItem;
  isToday?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        isToday
          ? "border-sky-500/40 bg-sky-500/5"
          : "border-border bg-card/50"
      }`}
    >
      <h3
        className={`mb-3 text-lg font-semibold ${
          isToday ? "text-sky-400" : "text-foreground"
        }`}
      >
        {isToday ? (
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-sky-400" />
        ) : null}
        {day.label}
      </h3>
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {day.items.map((item, i) => (
          <DayItemCard
            key={`${day.date}-${item.title.slice(0, 20)}-${i}`}
            item={item}
            size="sm"
          />
        ))}
      </div>
    </div>
  );
}
