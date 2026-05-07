"use client";

import { useState, useMemo } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DayItem, Account, PipelineItem } from "./types";
import type { UnifiedAccount } from "./unified-view";
import type { RunwayFlag } from "@/lib/runway/flags";
import type { SeverityCounts, ClientRundownData } from "@/lib/runway/gantt/types";
import { parseISODate } from "./date-utils";
import { mergeWeekendDays, groupByWeek, filterSpanningFromDayCells } from "./runway-board-utils";
import { DayColumn } from "./components/day-column";
import { TodaySection } from "./components/today-section";
import { AccountSection } from "./components/account-section";
import { GanttChartsSection } from "./components/gantt-charts-section";
import { PipelineRow } from "./components/pipeline-row";
import { FlagsPanel } from "./components/flags-panel";
import { NeedsUpdateSection } from "./components/needs-update-section";
import { InFlightSection } from "./components/in-flight-section";
import { toggleInFlightAction } from "./actions";
import { useVersionPoll } from "./use-version-poll";

type View = "triage" | "accounts" | "gantt-charts" | "pipeline";

interface RunwayBoardProps {
  thisWeek: DayItem[];
  upcoming: DayItem[];
  /**
   * Accepts either the base `Account[]` (legacy) or `UnifiedAccount[]`
   * with inline L2 milestones (chunk 3 #1). AccountSection renders both
   * shapes without branching.
   *
   * Track 3 Wave 4: each account may carry an optional `ganttContent`
   * ReactNode (the pre-rendered RSC dark Gantt embed) consumed by the
   * Gantt Charts tab, plus an optional `ganttSeverity` rollup used to
   * paint the AuditBadge above each card. AccountSection ignores both
   * fields; GanttChartsSection slots them inside each account card.
   *
   * Track 3 Wave 5: each account also carries an optional
   * `readyToCloseIds` Set<string> of L1 project ids whose weekItems are
   * all completed but the L1 itself isn't yet — surfaced as a small
   * "Ready to close?" chip in BOTH AccountSection (info-card) and
   * RundownContentRSC (dark Gantt embed) so the same signal lives in
   * both views.
   *
   * Track 4 Wave 4.3: each account additionally carries the raw filtered
   * `rundown` (`ClientRundownData | null`) so the new By Account tiered
   * swimlane can iterate sections directly via `<AccountTier ...>`. Null
   * when the client has no rundown row (data-integrity nudge).
   */
  accounts: Array<
    (Account | UnifiedAccount) & {
      rundown?: ClientRundownData | null;
      ganttContent?: ReactNode;
      ganttSeverity?: SeverityCounts;
      readyToCloseIds?: ReadonlySet<string>;
    }
  >;
  pipeline: PipelineItem[];
  flags?: RunwayFlag[];
  staleItems?: DayItem[];
  /** Initial persisted toggle value. Defaults to true (chunk 3 #6). */
  initialInFlightEnabled?: boolean;
  /**
   * Full unfiltered day-bucket array from `getWeekItems()`. Page-level
   * bucketing for thisWeek/upcoming drops past-Monday buckets, which
   * silently hid multi-week in-progress items from In Flight in prod.
   * This source bypasses that bucketing so InFlightSection sees them.
   */
  inFlightSource: DayItem[];
}

const TABS = [
  { key: "triage", label: "This Week" },
  { key: "accounts", label: "By Account" },
  { key: "gantt-charts", label: "Gantt Charts" },
  { key: "pipeline", label: "Pipeline" },
] as const;

function useBoardData(
  thisWeek: DayItem[],
  upcoming: DayItem[],
  pipeline: PipelineItem[]
) {
  // Recompute every render so the TV dashboard rolls over at midnight.
  // The board only re-renders when the version poll detects a change, so
  // the dashboard may sit idle for long stretches between renders.
  const todayStr = new Date().toDateString();

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

  const todayColumn = useMemo(
    () =>
      thisWeek.find(
        (day) => parseISODate(day.date).toDateString() === todayStr
      ) ?? null,
    [thisWeek, todayStr]
  );

  const restOfWeek = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    // dashboard-cleanup item 4: remove actively-spanning rows from day cells.
    // Once startDate <= today, the row lives in Today / In Flight, not the
    // day-grid cell anchored on its startDate.
    const nonTodayDays = thisWeek.filter(
      (day) => parseISODate(day.date).toDateString() !== todayStr
    );
    return mergeWeekendDays(filterSpanningFromDayCells(nonTodayDays, todayISO));
  }, [thisWeek, todayStr]);

  const upcomingWeeks = useMemo(
    () => groupByWeek(mergeWeekendDays(upcoming)),
    [upcoming]
  );

  return { pipelineTotal, todayColumn, restOfWeek, upcomingWeeks };
}

export function RunwayBoard({
  thisWeek,
  upcoming,
  accounts,
  pipeline,
  flags = [],
  staleItems = [],
  initialInFlightEnabled = true,
  inFlightSource,
}: RunwayBoardProps) {
  const router = useRouter();
  const [view, setView] = useState<View>("triage");
  const [inFlightEnabled, setInFlightEnabled] = useState(initialInFlightEnabled);
  const { pipelineTotal, todayColumn, restOfWeek, upcomingWeeks } = useBoardData(thisWeek, upcoming, pipeline);
  const { isStale } = useVersionPoll(router);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 2xl:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-3xl">
              Civilization Runway
            </h1>
            {isStale ? (
              <span
                role="status"
                className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground"
              >
                Live updates paused — refresh to reconnect
              </span>
            ) : null}
          </div>
          <nav className="flex gap-1 rounded-lg border border-border bg-card/50 p-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                className={`rounded-md px-3 py-2 text-xs font-medium transition-colors sm:px-5 sm:py-2.5 sm:text-sm ${
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

      <main className="mx-auto max-w-[1800px] px-4 py-4 sm:px-6 sm:py-6 2xl:px-10">
        <div className="flex xl:gap-6">
          <div className="min-w-0 flex-1">
            {view === "triage" ? (
              <div className="space-y-6 sm:space-y-10">
                <NeedsUpdateSection staleItems={staleItems} />
                <TodaySection todayColumn={todayColumn} />
                <InFlightSection
                  weekItems={inFlightSource}
                  enabled={inFlightEnabled}
                  onToggle={toggleInFlightAction}
                  onToggleChange={setInFlightEnabled}
                />

                {restOfWeek.length > 0 ? (
                  <section data-testid="this-week-section">
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

            {view === "gantt-charts" ? (
              <GanttChartsSection accounts={accounts} />
            ) : null}

            {view === "pipeline" ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <h2 className="font-display text-xl font-bold text-foreground sm:text-2xl">
                    Unsigned SOWs &amp; New Business
                  </h2>
                  <div className="sm:text-right">
                    <p className="text-sm text-muted-foreground">Total Pipeline</p>
                    <p className="font-mono text-2xl font-bold text-foreground sm:text-3xl">
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
          </div>

          {view !== "accounts" && view !== "gantt-charts" && <FlagsPanel flags={flags} />}
        </div>
      </main>
    </div>
  );
}
