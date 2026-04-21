/**
 * Runway Flag Detectors — individual detection functions used by analyzeFlags
 */

import { createHash } from "crypto";
import type { Account, DayItem, DayItemEntry } from "@/app/runway/types";
import { parseISODate, toISODateString } from "@/app/runway/date-utils";
import type { FlagSeverity, RunwayFlag } from "./flags";

export function flagId(type: string, ...parts: string[]): string {
  return createHash("sha256")
    .update([type, ...parts].join("|"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Resource conflicts: person has 3+ deliverables within 10 days across 2+ clients.
 */
export function detectResourceConflicts(
  thisWeek: DayItem[],
  upcoming: DayItem[]
): RunwayFlag[] {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + 10);

  // Collect owner -> Set<account> and count within 10 days
  const ownerAccounts = new Map<string, Set<string>>();
  const ownerCount = new Map<string, number>();

  for (const day of [...thisWeek, ...upcoming]) {
    const dayDate = parseISODate(day.date);
    if (dayDate > cutoff) continue;

    for (const item of day.items) {
      if (!item.owner) continue;
      // v4: skip completed L2s — they no longer count against capacity.
      if (item.status === "completed") continue;
      const owner = item.owner;

      if (!ownerAccounts.has(owner)) ownerAccounts.set(owner, new Set());
      ownerAccounts.get(owner)!.add(item.account);

      ownerCount.set(owner, (ownerCount.get(owner) ?? 0) + 1);
    }
  }

  const flags: RunwayFlag[] = [];
  for (const [owner, accounts] of ownerAccounts) {
    const count = ownerCount.get(owner) ?? 0;
    if (count >= 3 && accounts.size >= 2) {
      flags.push({
        id: flagId("resource-conflict", owner),
        type: "resource-conflict",
        severity: "warning",
        title: `${owner} has ${count} deliverables in 10 days`,
        detail: `Across ${accounts.size} clients: ${[...accounts].join(", ")}`,
        relatedPerson: owner,
      });
    }
  }
  return flags;
}

/**
 * Stale items: projects with staleDays >= 14.
 * Critical if >= 30, warning if >= 14.
 *
 * v4: excludes completed and on-hold projects — those are intentionally
 * paused and should not surface as stale. Uses Set for O(1) lookup.
 */
const STALE_EXCLUDED_STATUSES = new Set(["completed", "on-hold"]);

export function detectStaleItems(accounts: Account[]): RunwayFlag[] {
  const flags: RunwayFlag[] = [];
  for (const account of accounts) {
    for (const item of account.items) {
      if (STALE_EXCLUDED_STATUSES.has(item.status)) continue;
      if (item.staleDays != null && item.staleDays >= 14) {
        const severity: FlagSeverity = item.staleDays >= 30 ? "critical" : "warning";
        const waitingDetail = item.waitingOn
          ? ` -- waiting on ${item.waitingOn}`
          : "";
        flags.push({
          id: flagId("stale", account.slug, item.id),
          type: "stale",
          severity,
          title: `${item.title}${waitingDetail}`,
          detail: `${account.name} -- stale ${item.staleDays} days`,
          relatedClient: account.slug,
          relatedPerson: item.waitingOn,
        });
      }
    }
  }
  return flags;
}

/**
 * Upcoming deadlines: week items due today or tomorrow
 * with type "deadline" or "delivery".
 */
export function detectDeadlines(thisWeek: DayItem[]): RunwayFlag[] {
  const now = new Date();
  const todayStr = toISODateString(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toISODateString(tomorrow);

  const flags: RunwayFlag[] = [];
  for (const day of thisWeek) {
    if (day.date !== todayStr && day.date !== tomorrowStr) continue;

    const isToday = day.date === todayStr;
    for (const item of day.items) {
      if (item.type !== "deadline" && item.type !== "delivery") continue;
      flags.push({
        id: flagId("deadline", day.date, item.title, item.account),
        type: "deadline",
        severity: isToday ? "warning" : "info",
        title: `${item.account}: ${item.title}`,
        detail: isToday ? "Due today" : "Due tomorrow",
        relatedClient: item.account,
      });
    }
  }
  return flags;
}

/**
 * Bottlenecks: person appears as waitingOn on 3+ active items across clients.
 *
 * v4: only active projects count. Projects in terminal or paused states
 * (completed/blocked/on-hold) and stubs whose client is in awaiting-client
 * status are excluded — those are already flagged or dormant and should
 * not contribute to the bottleneck signal.
 */
const BOTTLENECK_EXCLUDED_STATUSES = new Set([
  "completed",
  "blocked",
  "on-hold",
  "awaiting-client",
]);

export function detectBottlenecks(accounts: Account[]): RunwayFlag[] {
  const waitingOnCounts = new Map<string, { count: number; clients: Set<string> }>();

  for (const account of accounts) {
    for (const item of account.items) {
      if (!item.waitingOn) continue;
      if (BOTTLENECK_EXCLUDED_STATUSES.has(item.status)) continue;
      const person = item.waitingOn;
      if (!waitingOnCounts.has(person)) {
        waitingOnCounts.set(person, { count: 0, clients: new Set() });
      }
      const entry = waitingOnCounts.get(person)!;
      entry.count++;
      entry.clients.add(account.name);
    }
  }

  const flags: RunwayFlag[] = [];
  for (const [person, { count, clients }] of waitingOnCounts) {
    if (count >= 3) {
      flags.push({
        id: flagId("bottleneck", person),
        type: "bottleneck",
        severity: "warning",
        title: `${person} has ${count} items in their inbox`,
        detail: `Across: ${[...clients].join(", ")}`,
        relatedPerson: person,
      });
    }
  }
  return flags;
}

/**
 * Past-end L2 items: L2 where `end_date < today AND status === 'in-progress'`.
 *
 * v4 convention §4 — surfaces items that the team has been actively working
 * on past their scheduled end. These need status review — either mark
 * completed, re-schedule, or flip to blocked. Severity scales with how far
 * past the end the item is to push the oldest drift to the top of the rail.
 *
 * Uses the same `DayItem[]` inputs as the other day-based detectors so the
 * caller only needs to supply this-week + upcoming (L2 boards).
 *
 * @see src/lib/runway/plate-summary.ts `pastEndRedNote` — per-item note
 *   rendered inline on cards. This detector rolls those conditions up for
 *   the global flags rail and the bot plate summary.
 */
export function detectPastEndL2s(
  thisWeek: DayItem[],
  upcoming: DayItem[]
): RunwayFlag[] {
  const now = new Date();
  const todayISO = toISODateString(now);
  const flags: RunwayFlag[] = [];
  // Dedupe by item id when available — same L2 may appear in thisWeek + upcoming
  // if boundaries overlap. Title+account fallback for items lacking id.
  const seen = new Set<string>();

  for (const day of [...thisWeek, ...upcoming]) {
    for (const item of day.items) {
      if (!isPastEndInProgress(item, todayISO)) continue;
      const dedupeKey = item.id ?? `${item.account}|${item.title}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const end = item.endDate ?? item.startDate ?? todayISO;
      const daysPast = daysBetweenISO(end, todayISO);
      // Critical when significantly past end (14+ days); warning otherwise.
      const severity: FlagSeverity = daysPast >= 14 ? "critical" : "warning";

      flags.push({
        id: flagId("past-end-l2", item.account, item.title, end),
        type: "past-end-l2",
        severity,
        title: `${item.account}: ${item.title}`,
        detail: `in-progress past end_date (${end}, ${daysPast} ${
          daysPast === 1 ? "day" : "days"
        } ago) — needs review`,
        relatedClient: item.account,
        ...(item.owner ? { relatedPerson: item.owner } : {}),
      });
    }
  }

  return flags;
}

/**
 * Predicate: does this day-item entry satisfy the past-end L2 condition?
 *
 * Exported for reuse by the bot plate summary — same criteria, same
 * behavior. Keep in sync with `plate-summary.pastEndRedNote` which adds
 * `daysSinceTouched` metadata for card rendering.
 */
export function isPastEndInProgress(
  item: DayItemEntry,
  todayISO: string
): boolean {
  if (item.status !== "in-progress") return false;
  const end = item.endDate ?? item.startDate ?? null;
  if (!end) return false;
  return end < todayISO;
}

/** Whole-day delta between two ISO dates (YYYY-MM-DD). Always non-negative. */
function daysBetweenISO(aISO: string, bISO: string): number {
  const a = Date.parse(aISO + "T00:00:00Z");
  const b = Date.parse(bISO + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / (24 * 60 * 60 * 1000)));
}
