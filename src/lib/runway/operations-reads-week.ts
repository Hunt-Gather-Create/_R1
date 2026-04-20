/**
 * Runway Read Operations — Week Items & Workload queries
 */

import { getRunwayDb } from "@/lib/db/runway";
import { clients, projects, weekItems } from "@/lib/db/runway-schema";
import { and, asc, eq } from "drizzle-orm";
import {
  getClientNameMap,
  matchesSubstring,
} from "./operations";

export type WeekItemRow = typeof weekItems.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;

export async function getLinkedWeekItems(projectId: string): Promise<WeekItemRow[]> {
  const db = getRunwayDb();
  return db.select().from(weekItems).where(eq(weekItems.projectId, projectId));
}

export async function getLinkedDeadlineItems(projectId: string): Promise<WeekItemRow[]> {
  const db = getRunwayDb();
  return db.select().from(weekItems)
    .where(and(eq(weekItems.projectId, projectId), eq(weekItems.category, "deadline")));
}

export async function getWeekItemsData(weekOf?: string, owner?: string, resource?: string) {
  const db = getRunwayDb();
  const clientNameById = await getClientNameMap();

  let items = weekOf
    ? await db
        .select()
        .from(weekItems)
        .where(eq(weekItems.weekOf, weekOf))
        .orderBy(asc(weekItems.date), asc(weekItems.sortOrder))
    : await db
        .select()
        .from(weekItems)
        .orderBy(asc(weekItems.date), asc(weekItems.sortOrder));

  if (owner) {
    items = items.filter((item) => matchesSubstring(item.owner, owner));
  }

  if (resource) {
    items = items.filter((item) => matchesSubstring(item.resources, resource));
  }

  return items.map((item) => ({
    date: item.date,
    dayOfWeek: item.dayOfWeek,
    title: item.title,
    account: item.clientId ? clientNameById.get(item.clientId) ?? null : null,
    category: item.category,
    owner: item.owner,
    resources: item.resources,
    notes: item.notes,
  }));
}

// ── getPersonWorkload (v4 contract) ─────────────────────
//
// Contract consumed by Chunk 2 (bot tools) and Chunk 3 (UI).
// Do not change the shape without updating both downstream chunks.

export interface PersonWorkload {
  person: string;
  ownedProjects: {
    inProgress: ProjectRow[];
    awaitingClient: ProjectRow[];
    blocked: ProjectRow[];
    onHold: ProjectRow[];
    completed: ProjectRow[]; // opt-in only via includeCompleted flag; default omitted (empty array)
  };
  weekItems: {
    overdue: WeekItemRow[];
    thisWeek: WeekItemRow[];
    nextWeek: WeekItemRow[];
    later: WeekItemRow[];
  };
  flags: {
    contractExpired: ClientRow[];
    retainerRenewalDue: ProjectRow[];
  };
  totalProjects: number;
  totalActiveWeekItems: number;
}

export interface GetPersonWorkloadOptions {
  /** Include status='completed' projects in ownedProjects.completed. Default false. */
  includeCompleted?: boolean;
  /** Override the current date. Used by tests. */
  now?: Date;
}

const ACTIVE_L1_STATUSES = new Set(["in-production", "not-started"]);
const AWAITING_CLIENT = "awaiting-client";
const COMPLETED_L2 = "completed";

/**
 * Project status buckets — ownedProjects sections.
 */
function bucketProject(status: string | null | undefined): keyof PersonWorkload["ownedProjects"] {
  switch (status) {
    case "awaiting-client":
      return "awaitingClient";
    case "blocked":
      return "blocked";
    case "on-hold":
      return "onHold";
    case "completed":
      return "completed";
    // "in-production", "not-started", null — all active
    default:
      return "inProgress";
  }
}

/**
 * Return YYYY-MM-DD in America/Chicago, stable across server timezones.
 * Used to anchor "today" + week-bucket boundaries.
 */
export function chicagoISODate(date: Date): string {
  // en-CA formatter produces YYYY-MM-DD directly.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

/**
 * Monday ISO-date (YYYY-MM-DD) of the week containing `dateISO`,
 * evaluated in America/Chicago. Sunday is treated as prior week's tail.
 */
function mondayOf(dateISO: string): string {
  // Parse as Chicago-anchored noon to avoid DST edge-cases.
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // getUTCDay: 0=Sun .. 6=Sat. Treat Sunday as prior week.
  const dow = dt.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Date-bucket an L2 into overdue / thisWeek / nextWeek / later.
 *
 * - overdue: (end_date ?? start_date) < today AND status != 'completed'
 * - thisWeek: start_date within current Monday–Sunday inclusive
 * - nextWeek: start_date within next Monday–Sunday inclusive
 * - later: start_date beyond next week
 *
 * Returns null if the item has no usable date (excluded from all buckets).
 */
function bucketWeekItem(
  item: WeekItemRow,
  todayISO: string,
  thisMondayISO: string,
  thisSundayISO: string,
  nextMondayISO: string,
  nextSundayISO: string
): keyof PersonWorkload["weekItems"] | null {
  const startDate = item.startDate ?? item.date;
  if (!startDate) return null;

  const endDate = item.endDate ?? startDate;

  // Overdue: end-or-start before today AND not already completed
  if (endDate < todayISO && item.status !== COMPLETED_L2) {
    return "overdue";
  }

  if (startDate >= thisMondayISO && startDate <= thisSundayISO) return "thisWeek";
  if (startDate >= nextMondayISO && startDate <= nextSundayISO) return "nextWeek";
  if (startDate > nextSundayISO) return "later";

  // start_date is in the past but end_date is not < today — treat as thisWeek
  // (covers multi-day spans that started earlier but are still current).
  if (startDate < thisMondayISO && endDate >= thisMondayISO) return "thisWeek";

  return null;
}

/**
 * Sort week items ascending by start_date (fallback date), then sortOrder.
 */
function sortWeekItems(items: WeekItemRow[]): WeekItemRow[] {
  return [...items].sort((a, b) => {
    const aStart = a.startDate ?? a.date ?? "";
    const bStart = b.startDate ?? b.date ?? "";
    if (aStart !== bStart) return aStart < bStart ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

/**
 * Get a person's workload bucketed per the v4 convention.
 *
 * @see docs/tmp/runway-v4-convention.md §"Convention-driven behaviors"
 */
export async function getPersonWorkload(
  personName: string,
  options: GetPersonWorkloadOptions = {}
): Promise<PersonWorkload> {
  const { includeCompleted = false, now = new Date() } = options;

  const db = getRunwayDb();

  // Load projects, week items, clients in parallel.
  const [allProjects, allWeekItems, allClients] = await Promise.all([
    db.select().from(projects).orderBy(asc(projects.sortOrder)),
    db.select().from(weekItems).orderBy(asc(weekItems.date), asc(weekItems.sortOrder)),
    db.select().from(clients),
  ]);

  // v4 §1: L1 surfaces only for its owner (not resources).
  const ownedProjects = allProjects.filter((p) => matchesSubstring(p.owner, personName));

  // L2s match on owner OR resources.
  const matchingWeekItems = allWeekItems.filter(
    (item) => matchesSubstring(item.owner, personName) || matchesSubstring(item.resources, personName)
  );

  // v4 §3: stub filter — hide L2s whose parent L1 has status=awaiting-client
  // from active buckets. (Still accessible via L1 drill-down.)
  const projectStatusById = new Map<string, string | null>();
  for (const p of allProjects) projectStatusById.set(p.id, p.status);

  const nonStubWeekItems = matchingWeekItems.filter((item) => {
    if (!item.projectId) return true;
    const parentStatus = projectStatusById.get(item.projectId);
    return parentStatus !== AWAITING_CLIENT;
  });

  // Date buckets — Chicago-anchored.
  const todayISO = chicagoISODate(now);
  const thisMondayISO = mondayOf(todayISO);
  const thisSundayISO = addDaysISO(thisMondayISO, 6);
  const nextMondayISO = addDaysISO(thisMondayISO, 7);
  const nextSundayISO = addDaysISO(thisMondayISO, 13);

  const weekBuckets: PersonWorkload["weekItems"] = {
    overdue: [],
    thisWeek: [],
    nextWeek: [],
    later: [],
  };

  for (const item of nonStubWeekItems) {
    const bucket = bucketWeekItem(
      item,
      todayISO,
      thisMondayISO,
      thisSundayISO,
      nextMondayISO,
      nextSundayISO
    );
    if (bucket) weekBuckets[bucket].push(item);
  }

  // Sort within each bucket by start_date ASC then sortOrder.
  weekBuckets.overdue = sortWeekItems(weekBuckets.overdue);
  weekBuckets.thisWeek = sortWeekItems(weekBuckets.thisWeek);
  weekBuckets.nextWeek = sortWeekItems(weekBuckets.nextWeek);
  weekBuckets.later = sortWeekItems(weekBuckets.later);

  // Bucket owned L1s by status.
  const ownedBuckets: PersonWorkload["ownedProjects"] = {
    inProgress: [],
    awaitingClient: [],
    blocked: [],
    onHold: [],
    completed: [],
  };

  for (const p of ownedProjects) {
    const bucket = bucketProject(p.status);
    if (bucket === "completed" && !includeCompleted) continue;
    ownedBuckets[bucket].push(p);
  }

  // Soft flag: contractExpired — clients with contract_status='expired'
  // and an active owned L1 (status IN active set) that has the person as owner.
  const activeOwnedByClient = new Set<string>();
  for (const p of ownedProjects) {
    if (ACTIVE_L1_STATUSES.has(p.status ?? "")) {
      activeOwnedByClient.add(p.clientId);
    }
  }
  const contractExpired = allClients.filter(
    (c) => c.contractStatus === "expired" && activeOwnedByClient.has(c.id)
  );

  // Soft flag: retainerRenewalDue — engagement_type='retainer' AND
  // contract_end within 30 days (inclusive of today, forward only).
  const thirtyDaysOutISO = addDaysISO(todayISO, 30);
  const retainerRenewalDue = ownedProjects.filter((p) => {
    if (p.engagementType !== "retainer") return false;
    if (!p.contractEnd) return false;
    return p.contractEnd >= todayISO && p.contractEnd <= thirtyDaysOutISO;
  });

  const totalActiveWeekItems =
    weekBuckets.overdue.length +
    weekBuckets.thisWeek.length +
    weekBuckets.nextWeek.length +
    weekBuckets.later.length;

  return {
    person: personName,
    ownedProjects: ownedBuckets,
    weekItems: weekBuckets,
    flags: {
      contractExpired,
      retainerRenewalDue,
    },
    // totalProjects counts all non-completed owned L1s (or all, if includeCompleted).
    totalProjects:
      ownedBuckets.inProgress.length +
      ownedBuckets.awaitingClient.length +
      ownedBuckets.blocked.length +
      ownedBuckets.onHold.length +
      (includeCompleted ? ownedBuckets.completed.length : 0),
    totalActiveWeekItems,
  };
}
