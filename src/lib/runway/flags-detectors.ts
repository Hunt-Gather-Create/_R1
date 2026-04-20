/**
 * Runway Flag Detectors — individual detection functions used by analyzeFlags
 */

import { createHash } from "crypto";
import type { Account, DayItem } from "@/app/runway/types";
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
 * Bottlenecks: person appears as waitingOn on 3+ items across clients.
 */
export function detectBottlenecks(accounts: Account[]): RunwayFlag[] {
  const waitingOnCounts = new Map<string, { count: number; clients: Set<string> }>();

  for (const account of accounts) {
    for (const item of account.items) {
      if (!item.waitingOn) continue;
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
