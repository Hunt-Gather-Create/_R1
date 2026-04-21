/**
 * Runway Read Operations — aggregate flags surface
 *
 * Single DB-level entry point for every "soft flag" the board and bot raise:
 *   - past-end-l2      — L2 in-progress items past their end_date
 *   - stale            — L1 projects with staleDays >= 14
 *   - bottleneck       — waitingOn counts across active L1s
 *   - deadline         — today/tomorrow deadline or delivery L2s
 *   - resource-conflict — overloaded owners within a 10-day window
 *   - retainer-renewal — L1 retainers with contract_end within 30 days
 *   - contract-expired — clients with expired contracts + active owned L1
 *
 * Reuses the existing detectors in `flags-detectors.ts` and pill helpers in
 * `plate-summary.ts` — no behavioral drift vs the UI board's
 * `analyzeFlags()` call. This module only provides the DB→UI-shape adapter
 * so MCP + bot callers can request flags without re-implementing the query.
 *
 * v4 convention (2026-04-21).
 */

import { getRunwayDb } from "@/lib/db/runway";
import {
  clients as clientsTable,
  pipelineItems,
  projects,
  weekItems,
} from "@/lib/db/runway-schema";
import { asc } from "drizzle-orm";
import type {
  Account,
  DayItem,
  DayItemEntry,
  DayItemType,
  ItemCategory,
  ItemStatus,
  PipelineItem,
  TriageItem,
} from "@/app/runway/types";
import type { RunwayFlag } from "./flags";
import { analyzeFlags } from "./flags";
import {
  contractExpiredPills,
  retainerRenewalPills,
  type ContractExpiredPill,
  type RetainerRenewalPill,
  toISODate,
} from "./plate-summary";
import { getMondayISODate, parseISODate } from "@/app/runway/date-utils";

export interface GetFlagsOptions {
  /** Narrow to a single client (matches UI Account.slug). */
  clientSlug?: string;
  /** Narrow to flags where the owner or waitingOn person matches (substring). */
  personName?: string;
  /** Override the current date (used by tests to pin bucket boundaries). */
  now?: Date;
}

export interface GetFlagsResult {
  flags: RunwayFlag[];
  retainerRenewalDue: RetainerRenewalPill[];
  contractExpired: ContractExpiredPill[];
}

/**
 * Load DB rows and run every flag detector + pill helper through them,
 * optionally narrowed by clientSlug / personName.
 *
 * The heavy lifting lives in the shared `analyzeFlags` and plate-summary
 * helpers. This function is the DB-level adapter — it exists so the MCP +
 * bot don't need to reassemble the UI shapes themselves.
 */
export async function getFlags(
  opts: GetFlagsOptions = {}
): Promise<GetFlagsResult> {
  const { clientSlug, personName, now = new Date() } = opts;
  const db = getRunwayDb();

  const [allClients, allProjects, allWeekItems, allPipeline] = await Promise.all([
    db.select().from(clientsTable),
    db.select().from(projects).orderBy(asc(projects.sortOrder)),
    db.select().from(weekItems).orderBy(asc(weekItems.date), asc(weekItems.sortOrder)),
    db.select().from(pipelineItems).orderBy(asc(pipelineItems.sortOrder)),
  ]);

  const clientById = new Map(allClients.map((c) => [c.id, c]));
  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));

  // ── Build Account[] (L1 + contract metadata) ───────────
  const projectsByClient = new Map<string, typeof allProjects>();
  for (const p of allProjects) {
    const list = projectsByClient.get(p.clientId) ?? [];
    list.push(p);
    projectsByClient.set(p.clientId, list);
  }

  const accounts: Account[] = allClients.map((c) => {
    const items: TriageItem[] = (projectsByClient.get(c.id) ?? []).map((p) => ({
      id: p.id,
      title: p.name,
      status: (p.status ?? "not-started") as ItemStatus,
      category: (p.category ?? "active") as ItemCategory,
      owner: p.owner ?? undefined,
      resources: p.resources ?? undefined,
      waitingOn: p.waitingOn ?? undefined,
      notes: p.notes ?? undefined,
      staleDays: p.staleDays ?? undefined,
      startDate: p.startDate ?? null,
      endDate: p.endDate ?? null,
      engagementType: (p.engagementType ?? null) as
        | "project"
        | "retainer"
        | "break-fix"
        | null,
      contractEnd: p.contractEnd ?? null,
    }));
    return {
      name: c.name,
      slug: c.slug,
      contractValue: c.contractValue ?? undefined,
      contractTerm: c.contractTerm ?? undefined,
      contractStatus: (c.contractStatus ?? "signed") as
        | "signed"
        | "unsigned"
        | "expired",
      team: c.team ?? undefined,
      items,
    };
  });

  // ── Build DayItem[] split into thisWeek + upcoming ──────
  const todayMonday = getMondayISODate(now);
  const entriesByDate = new Map<string, DayItemEntry[]>();

  for (const w of allWeekItems) {
    const anchor = w.date;
    if (!anchor) continue;
    const list = entriesByDate.get(anchor) ?? [];
    const client = w.clientId ? clientById.get(w.clientId) : undefined;
    const entry: DayItemEntry = {
      id: w.id,
      projectId: w.projectId ?? null,
      title: w.title,
      account: client?.name ?? "",
      owner: w.owner ?? undefined,
      resources: w.resources ?? undefined,
      type: (w.category ?? "delivery") as DayItemType,
      notes: w.notes ?? undefined,
      status: w.status ?? null,
      startDate: w.startDate ?? null,
      endDate: w.endDate ?? null,
      updatedAtMs: w.updatedAt ? w.updatedAt.getTime() : null,
      // blockedBy refs require weekItem id→row lookup. For flag detectors
      // (which currently don't consume blockedBy) we leave this null.
      blockedBy: null,
    };
    list.push(entry);
    entriesByDate.set(anchor, list);
  }

  const sortedDates = [...entriesByDate.keys()].sort();
  const thisWeek: DayItem[] = [];
  const upcoming: DayItem[] = [];
  for (const dateStr of sortedDates) {
    const itemMonday = getMondayISODate(parseISODate(dateStr));
    const day: DayItem = {
      date: dateStr,
      label: dateStr,
      items: entriesByDate.get(dateStr) ?? [],
    };
    if (itemMonday === todayMonday) thisWeek.push(day);
    else if (itemMonday > todayMonday) upcoming.push(day);
    // Items in prior weeks are not fed to detectors (matches UI behavior).
  }

  // ── Build PipelineItem[] ────────────────────────────────
  const pipeline: PipelineItem[] = allPipeline.map((p) => ({
    account: p.clientId ? clientNameById.get(p.clientId) ?? "" : "",
    title: p.name,
    value: p.estimatedValue ?? "TBD",
    status: (p.status ?? "drafting") as
      | "scoping"
      | "drafting"
      | "sow-sent"
      | "verbal"
      | "signed"
      | "at-risk",
    owner: p.owner ?? undefined,
    waitingOn: p.waitingOn ?? undefined,
    notes: p.notes ?? undefined,
  }));

  // ── Run detectors + pill helpers ────────────────────────
  const flags = analyzeFlags(accounts, thisWeek, upcoming, pipeline);

  const nowISO = toISODate(now);
  // Retainer renewals: scan all L1 triage items across accounts.
  const allTriageItems = accounts.flatMap((a) => a.items);
  const retainerRenewalDue = retainerRenewalPills(allTriageItems, nowISO);
  const contractExpired = contractExpiredPills(accounts);

  // ── Apply optional narrowing filters ────────────────────
  const filteredFlags = narrowFlags(flags, clientSlug, personName, accounts);
  const filteredRetainers = clientSlug
    ? retainerRenewalDue.filter((p) =>
        accountHasProject(accounts, clientSlug, p.projectName)
      )
    : retainerRenewalDue;
  const filteredExpired = clientSlug
    ? contractExpired.filter((p) => {
        const account = accounts.find((a) => a.slug === clientSlug);
        return account?.name === p.clientName;
      })
    : contractExpired;

  return {
    flags: filteredFlags,
    retainerRenewalDue: filteredRetainers,
    contractExpired: filteredExpired,
  };
}

function narrowFlags(
  flags: RunwayFlag[],
  clientSlug: string | undefined,
  personName: string | undefined,
  accounts: Account[]
): RunwayFlag[] {
  if (!clientSlug && !personName) return flags;

  // Narrow by clientSlug: match against relatedClient (which detectors set
  // to either the slug or the account name depending on the detector).
  // Pre-resolve the slug → name so we can match either.
  const clientAccount = clientSlug
    ? accounts.find((a) => a.slug === clientSlug)
    : undefined;
  const clientName = clientAccount?.name;

  return flags.filter((f) => {
    if (clientSlug) {
      const related = f.relatedClient;
      if (!related) return false;
      if (related !== clientSlug && related !== clientName) return false;
    }
    if (personName) {
      const person = f.relatedPerson;
      if (!person) return false;
      if (!person.toLowerCase().includes(personName.toLowerCase())) return false;
    }
    return true;
  });
}

function accountHasProject(
  accounts: Account[],
  slug: string,
  projectName: string
): boolean {
  const account = accounts.find((a) => a.slug === slug);
  if (!account) return false;
  return account.items.some((i) => i.title === projectName);
}
