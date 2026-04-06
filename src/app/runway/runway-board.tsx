"use client";

import { useState, useMemo } from "react";
import type { DayItem, Account, PipelineItem } from "./types";
import { parseISODate } from "./date-utils";
import { DayColumn } from "./components/day-column";
import { TodaySection } from "./components/today-section";
import { AccountSection } from "./components/account-section";
import { PipelineRow } from "./components/pipeline-row";

type View = "triage" | "accounts" | "pipeline";

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
  const [view, setView] = useState<View>("triage");

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
      thisWeek.filter(
        (day) => parseISODate(day.date).toDateString() !== todayStr
      ),
    [thisWeek, todayStr]
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4 2xl:px-10">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
              Civilization Runway
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Live from database
            </p>
          </div>
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

            <section>
              <h2 className="mb-4 font-display text-2xl font-bold text-foreground">
                Upcoming
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {upcoming.map((day) => (
                  <DayColumn key={day.date} day={day} isToday={false} />
                ))}
              </div>
            </section>
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
