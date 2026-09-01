"use client";

/**
 * #64 Status View — Monday standup tab.
 *
 * Surfaces every active card grouped Account (alpha) → Project (alpha) →
 * Card (date ASC), with a bottom-banner color indicating which bucket the
 * card inherits from:
 *
 *   - Red    → Needs Update (past-due) or Blocked
 *   - White  → Today
 *   - Yellow → Kicks Off This Week (#71 — Tue-Fri startDate inside this work week)
 *   - Blue   → In Flight
 *
 * Source data is the same predicates already routed by the dashboard
 * (filterSpanningFromDayCells guarantees mutual exclusion in production),
 * so this view doesn't introduce new precedence logic — it just
 * re-projects the existing buckets by Account/Project.
 *
 * Cards reuse `DayItemCard` with `size="lg"` and the new `bottomBanner`
 * accent so checkbox + (future) pencil affordances behave identically to
 * the other surfaces.
 */

import { useMemo } from "react";
import type { DayItem, DayItemEntry } from "../types";
import { filterInFlight } from "@/lib/runway/plate-summary";
import { DayItemCard, type CardBottomBanner } from "./day-item-card";
import { chicagoToday } from "@/lib/runway/date-chicago";

type StatusBucket = CardBottomBanner;

type StatusItem = {
  item: DayItemEntry;
  bucket: StatusBucket;
};

type StatusViewProps = {
  /** Items past their endDate and not terminal — Needs Update bucket source. */
  staleItems: DayItem[];
  /** Day-column matching today's date — Today bucket source. */
  todayColumn: DayItem | null;
  /**
   * Non-today day-columns of THIS work week (Tue-Fri when today is Mon).
   * #71 Kicks Off This Week bucket source — items matching the predicate
   * (`startDate > today AND startDate <= endOfWorkWeek AND status not in
   * {completed, canceled, blocked}`) get the yellow banner.
   */
  kicksOffSource: DayItem[];
  /** Full unfiltered day-bucket source — In Flight bucket via filterInFlight. */
  inFlightSource: DayItem[];
  /** Override for tests; production uses today's UTC date. */
  nowISO?: string;
};

const BLOCKED_PLACEHOLDER_KEY = "9999-12-31";
const KICKS_OFF_EXCLUDED_STATUSES = new Set(["completed", "canceled", "blocked"]);

/**
 * End-of-work-week ISO date (Friday inclusive) relative to a given ISO
 * weekday. Mon-Fri returns this week's Friday; Sat-Sun returns next
 * Friday so the kicks-off window always anchors to the upcoming work
 * week. Used by the #71 Kicks Off This Week predicate.
 */
export function endOfWorkWeekISO(todayISO: string): string {
  // Parse as UTC midnight so addDays arithmetic doesn't drift across DST.
  const base = new Date(`${todayISO}T00:00:00Z`);
  const dayOfWeek = base.getUTCDay(); // 0 = Sun, 1 = Mon, ... 5 = Fri, 6 = Sat
  const daysToFriday = (5 - dayOfWeek + 7) % 7;
  base.setUTCDate(base.getUTCDate() + daysToFriday);
  return base.toISOString().slice(0, 10);
}

/**
 * Bucket every active card into exactly one of the four Status View
 * buckets. Iteration order matches plan precedence: Needs Update → Today
 * → Kicks Off → In Flight. Items already bucketed are skipped on later
 * passes so a row never double-counts. Blocked items are pulled into
 * Needs Update (red banner) regardless of their original bucket — plan:
 * blocked is always a stop signal.
 */
export function computeStatusItems(
  staleItems: DayItem[],
  todayColumn: DayItem | null,
  kicksOffSource: DayItem[],
  inFlightSource: DayItem[],
  nowISO: string,
): StatusItem[] {
  const out: StatusItem[] = [];
  const seen = new Set<string>();

  function consume(items: readonly DayItemEntry[], bucket: StatusBucket) {
    for (const item of items) {
      const id = item.id;
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ item, bucket });
    }
  }

  for (const day of staleItems) consume(day.items, "needs-update");
  if (todayColumn) consume(todayColumn.items, "today");

  // #71 Kicks Off This Week — predicate run against the non-today days of
  // this work week. Source items come from runway-board's `restOfWeek`
  // (already filterSpanningFromDayCells'd), so they're anchored on their
  // startDate; the predicate just confirms the date window + status gate.
  const eowISO = endOfWorkWeekISO(nowISO);
  const kicksOff = kicksOffSource
    .flatMap((d) => d.items)
    .filter((item) => isKicksOffCandidate(item, nowISO, eowISO));
  consume(kicksOff, "kicks-off");

  const flat = inFlightSource.flatMap((d) => d.items);
  consume(filterInFlight(flat, nowISO), "in-flight");

  for (const entry of out) {
    if (entry.item.status === "blocked") entry.bucket = "needs-update";
  }

  return out;
}

function isKicksOffCandidate(
  item: DayItemEntry,
  todayISO: string,
  eowISO: string,
): boolean {
  if (!item.startDate) return false;
  if (item.startDate <= todayISO) return false;
  if (item.startDate > eowISO) return false;
  const status = item.status ?? "";
  if (KICKS_OFF_EXCLUDED_STATUSES.has(status)) return false;
  return true;
}

/**
 * Per-project sort comparator. Blocked-with-no-endDate items rank first
 * (oldest-stuck-first via `updatedAtMs` ASC); everything else sorts by
 * the earliest visible date (startDate ?? endDate). Null dates fall last.
 */
function projectSortKey(item: DayItemEntry): {
  tier: 0 | 1;
  primary: string | number;
} {
  const blockedNoEnd = item.status === "blocked" && !item.endDate;
  if (blockedNoEnd) {
    return { tier: 0, primary: item.updatedAtMs ?? Number.MAX_SAFE_INTEGER };
  }
  return {
    tier: 1,
    primary: item.startDate ?? item.endDate ?? BLOCKED_PLACEHOLDER_KEY,
  };
}

type ProjectGroup = {
  projectName: string;
  items: StatusItem[];
};

type AccountGroup = {
  accountName: string;
  projects: ProjectGroup[];
};

/**
 * Group a flat StatusItem[] by Account (alpha) → Project (alpha) → date.
 * "Project" uses the WI's `parentProjectName` (set in queries.ts to the
 * WI's owning project name); items without one collapse into a single
 * `"(Other)"` bucket so they don't disappear silently.
 */
export function groupStatusItems(items: StatusItem[]): AccountGroup[] {
  const byAccount = new Map<string, Map<string, StatusItem[]>>();
  for (const entry of items) {
    const accountName = entry.item.account || "(Unknown account)";
    const projectName = entry.item.parentProjectName ?? "(Other)";
    let projectMap = byAccount.get(accountName);
    if (!projectMap) {
      projectMap = new Map();
      byAccount.set(accountName, projectMap);
    }
    const bucket = projectMap.get(projectName);
    if (bucket) bucket.push(entry);
    else projectMap.set(projectName, [entry]);
  }
  const accounts: AccountGroup[] = [];
  for (const [accountName, projectMap] of byAccount) {
    const projects: ProjectGroup[] = [];
    for (const [projectName, projectItems] of projectMap) {
      const sorted = [...projectItems].sort((a, b) => {
        const ka = projectSortKey(a.item);
        const kb = projectSortKey(b.item);
        if (ka.tier !== kb.tier) return ka.tier - kb.tier;
        if (ka.primary < kb.primary) return -1;
        if (ka.primary > kb.primary) return 1;
        return 0;
      });
      projects.push({ projectName, items: sorted });
    }
    projects.sort((a, b) =>
      a.projectName.localeCompare(b.projectName, undefined, {
        sensitivity: "base",
      }),
    );
    accounts.push({ accountName, projects });
  }
  accounts.sort((a, b) =>
    a.accountName.localeCompare(b.accountName, undefined, {
      sensitivity: "base",
    }),
  );
  return accounts;
}

export function StatusView({
  staleItems,
  todayColumn,
  kicksOffSource,
  inFlightSource,
  nowISO,
}: StatusViewProps) {
  const groups = useMemo(() => {
    // Chicago, not the viewer's own device clock, refs _R1#128. This is a
    // client component, so the old fallback read whatever timezone the
    // viewer's browser happened to be set to, not the server's clock and
    // not necessarily Chicago either, disagreeing with todayColumn and
    // staleItems below, which are already Chicago-computed server side.
    const today = nowISO ?? chicagoToday();
    const items = computeStatusItems(
      staleItems,
      todayColumn,
      kicksOffSource,
      inFlightSource,
      today,
    );
    return groupStatusItems(items);
  }, [staleItems, todayColumn, kicksOffSource, inFlightSource, nowISO]);

  if (groups.length === 0) {
    return (
      <div
        data-testid="status-view-empty"
        className="py-12 text-center text-sm text-muted-foreground"
      >
        Nothing to surface this week — all clear.
      </div>
    );
  }

  return (
    <div data-testid="status-view" className="space-y-6">
      {groups.map((account) => (
        <section
          key={account.accountName}
          data-testid="status-view-account"
          data-account={account.accountName}
          className="rounded-xl border border-border bg-card/30 p-3 sm:p-5"
        >
          <h2 className="font-display text-xl font-bold text-foreground">
            {account.accountName}
          </h2>
          <div className="mt-3 space-y-4">
            {account.projects.map((project) => (
              <div
                key={project.projectName}
                data-testid="status-view-project"
                data-project={project.projectName}
              >
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {project.projectName}
                </h3>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {project.items.map((entry, i) => (
                    <DayItemCard
                      key={entry.item.id ?? `${entry.item.title}|${i}`}
                      item={entry.item}
                      size="lg"
                      bottomBanner={entry.bucket}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
