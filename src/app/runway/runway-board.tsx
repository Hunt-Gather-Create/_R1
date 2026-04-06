"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { DayItem, Account, PipelineItem } from "./types";
import { parseISODate, getMondayISODate } from "./date-utils";
import { DayColumn } from "./components/day-column";
import { TodaySection } from "./components/today-section";
import { AccountSection } from "./components/account-section";
import { PipelineRow } from "./components/pipeline-row";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

type View = "triage" | "accounts" | "pipeline";

/**
 * Merge adjacent Saturday/Sunday DayItems into a single "Weekend" column.
 * If only one of Sat/Sun exists, it passes through unchanged.
 */
export function mergeWeekendDays(days: DayItem[]): DayItem[] {
  const result: DayItem[] = [];
  let i = 0;
  while (i < days.length) {
    const d = parseISODate(days[i].date);
    const dayOfWeek = d.getDay();

    if (dayOfWeek === 6 && i + 1 < days.length) {
      const next = parseISODate(days[i + 1].date);
      if (next.getDay() === 0) {
        result.push({
          date: days[i].date,
          label: "Weekend",
          items: [...days[i].items, ...days[i + 1].items],
        });
        i += 2;
        continue;
      }
    }
    result.push(days[i]);
    i++;
  }
  return result;
}

export interface WeekGroup {
  mondayDate: string;
  label: string;
  days: DayItem[];
}

/**
 * Group days by their week's Monday, producing a "w/o M/D" label for each group.
 */
export function groupByWeek(days: DayItem[]): WeekGroup[] {
  const groups: Map<string, DayItem[]> = new Map();
  for (const day of days) {
    const monday = getMondayISODate(parseISODate(day.date));
    const existing = groups.get(monday);
    if (existing) {
      existing.push(day);
    } else {
      groups.set(monday, [day]);
    }
  }
  return Array.from(groups.entries()).map(([monday, weekDays]) => {
    const d = parseISODate(monday);
    return {
      mondayDate: monday,
      label: `w/o ${d.getMonth() + 1}/${d.getDate()}`,
      days: weekDays,
    };
  });
}

interface RunwayBoardProps {
  thisWeek: DayItem[];
  upcoming: DayItem[];
  accounts: Account[];
  pipeline: PipelineItem[];
}

const TABS = [
  { key: "triage", label: "This Week" },
  { key: "accounts", label: "By Account" },
  { key: "pipeline", label: "Pipeline" },
] as const;

export function RunwayBoard({
  thisWeek,
  upcoming,
  accounts,
  pipeline,
}: RunwayBoardProps) {
  const router = useRouter();
  const [view, setView] = useState<View>("triage");

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  const pipelineTotal = useMemo(
    () =>
      pipeline
        .filter((p) => p.value !== "TBD")
        .reduce((sum, p) => {
          const num = parseInt(p.value.replace(/[$,]/g, ""), 10);
          return sum + (isNaN(num) ? 0 : num);
        }, 0),
    [pipeline]
  );

  const todayStr = useMemo(() => new Date().toDateString(), []);

  const todayColumn = useMemo(
    () =>
      thisWeek.find(
        (day) => parseISODate(day.date).toDateString() === todayStr
      ) ?? null,
    [thisWeek, todayStr]
  );

  const restOfWeek = useMemo(
    () =>
      mergeWeekendDays(
        thisWeek.filter(
          (day) => parseISODate(day.date).toDateString() !== todayStr
        )
      ),
    [thisWeek, todayStr]
  );

  const upcomingWeeks = useMemo(
    () => groupByWeek(mergeWeekendDays(upcoming)),
    [upcoming]
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4 2xl:px-10">
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
            Civilization Runway
          </h1>
          <nav className="flex gap-1 rounded-lg border border-border bg-card/50 p-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                className={`rounded-md px-5 py-2.5 text-sm font-medium transition-colors ${
                  view === tab.key
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-6 2xl:px-10">
        {view === "triage" ? (
          <div className="space-y-10">
            <TodaySection todayColumn={todayColumn} />

            {restOfWeek.length > 0 ? (
              <section>
                <h2 className="mb-4 font-display text-2xl font-bold text-foreground">
                  This Week
                </h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {restOfWeek.map((day) => (
                    <DayColumn key={day.date} day={day} isToday={false} />
                  ))}
                </div>
              </section>
            ) : null}

            {upcomingWeeks.map((week) => (
              <section key={week.mondayDate}>
                <h2 className="mb-4 font-display text-2xl font-bold text-foreground">
                  Upcoming{" "}
                  <span className="text-lg font-normal text-muted-foreground">
                    {week.label}
                  </span>
                </h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {week.days.map((day) => (
                    <DayColumn key={day.date} day={day} isToday={false} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {view === "accounts" ? (
          <div className="space-y-6">
            {accounts.map((account) => (
              <AccountSection key={account.slug} account={account} />
            ))}
          </div>
        ) : null}

        {view === "pipeline" ? (
          <div className="space-y-6">
            <div className="flex items-end justify-between">
              <h2 className="font-display text-2xl font-bold text-foreground">
                Unsigned SOWs &amp; New Business
              </h2>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total Pipeline</p>
                <p className="font-mono text-3xl font-bold text-foreground">
                  ${pipelineTotal.toLocaleString()}+
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {pipeline.map((item) => (
                <PipelineRow
                  key={`${item.account}-${item.title}`}
                  item={item}
                />
              ))}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
