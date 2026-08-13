"use client";

import type { DayItem } from "../types";
import { chicagoDisplayDate } from "@/lib/runway/date-chicago";
import { DayItemCard } from "./day-item-card";

export function TodaySection({
  todayColumn,
}: {
  todayColumn: DayItem | null;
}) {
  // One Chicago day-bucket everywhere (issue #43).
  const todayFormatted = chicagoDisplayDate();

  return (
    <section data-testid="today-section">
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
              key={item.id ?? `${item.account}|${item.title}|${i}`}
              item={item}
              size="lg"
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
