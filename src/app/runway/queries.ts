import { getRunwayDb } from "@/lib/db/runway";
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
  updates,
} from "@/lib/db/runway-schema";
import { eq, and, gte, lte, asc } from "drizzle-orm";
import type { ClientWithProjects, DayItemType, PipelineRow, WeekDay } from "./types";
import { parseISODate, getMonday, getMondayISODate, toISODateString } from "./date-utils";
import { getClientNameMap, groupBy } from "@/lib/runway/operations";

// ── Shared helpers ──────────────────────────────────────

const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDayLabel(dateStr: string): string {
  const d = parseISODate(dateStr);
  return `${SHORT_DAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

type WeekItemRow = typeof weekItems.$inferSelect;

/**
 * Parse blockedBy JSON array from storage. Returns empty array on null/invalid.
 * Storage shape: `["id1","id2"]`.
 */
function parseBlockedByIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/**
 * Resolve a week item's blockedBy id list to {id, title, status} refs.
 * Unresolved ids (blocker not in the provided map) are dropped — the UI
 * renders only visible blockers. Callers can still check raw ids if needed.
 */
function resolveBlockedByRefs(
  raw: string | null | undefined,
  weekItemById: Map<string, WeekItemRow>
): Array<{ id: string; title: string; status?: string | null }> {
  const ids = parseBlockedByIds(raw);
  if (ids.length === 0) return [];
  const refs: Array<{ id: string; title: string; status?: string | null }> = [];
  for (const id of ids) {
    const blocker = weekItemById.get(id);
    if (!blocker) continue;
    refs.push({ id, title: blocker.title, status: blocker.status });
  }
  return refs;
}

function mapWeekItemToEntry(
  item: WeekItemRow,
  clientNameById: Map<string, string>,
  weekItemById: Map<string, WeekItemRow>
): WeekDay["items"][number] {
  const blockedByRefs = resolveBlockedByRefs(item.blockedBy, weekItemById);
  const updatedMs = item.updatedAt ? item.updatedAt.getTime() : null;
  return {
    id: item.id,
    title: item.title,
    account: item.clientId ? (clientNameById.get(item.clientId) ?? "") : "",
    ...(item.owner ? { owner: item.owner } : {}),
    ...(item.resources ? { resources: item.resources } : {}),
    type: (item.category ?? "delivery") as DayItemType,
    ...(item.notes ? { notes: item.notes } : {}),
    // v4: pass L2 status through so flag detectors can filter active items.
    ...(item.status != null ? { status: item.status } : {}),
    ...(item.startDate != null ? { startDate: item.startDate } : {}),
    ...(item.endDate != null ? { endDate: item.endDate } : {}),
    ...(updatedMs != null ? { updatedAtMs: updatedMs } : {}),
    ...(blockedByRefs.length > 0 ? { blockedBy: blockedByRefs } : {}),
  };
}

function groupWeekItemsIntoDays(
  items: WeekItemRow[],
  clientNameById: Map<string, string>
): WeekDay[] {
  const grouped = groupBy(items, (item) => item.date ?? "");
  const sortedDates = [...grouped.keys()].sort();
  // Build an id→item map so resolveBlockedByRefs can decorate each entry
  // with blocker title/status without extra queries (O(1) lookups).
  const weekItemById = new Map<string, WeekItemRow>();
  for (const item of items) weekItemById.set(item.id, item);
  return sortedDates.map((dateStr) => ({
    date: dateStr,
    label: formatDayLabel(dateStr),
    items: (grouped.get(dateStr) ?? []).map((item) =>
      mapWeekItemToEntry(item, clientNameById, weekItemById)
    ),
  }));
}

// ── Queries ─────────────────────────────────────────────

export async function getClientsWithProjects(): Promise<ClientWithProjects[]> {
  const db = getRunwayDb();

  const allClients = await db
    .select()
    .from(clients)
    .orderBy(asc(clients.name));

  const allProjects = await db
    .select()
    .from(projects)
    .orderBy(asc(projects.sortOrder));

  // Group projects by clientId using Map for O(1) lookups
  const projectsByClient = groupBy(allProjects, (p) => p.clientId);

  return allClients.map((client) => ({
    ...client,
    items: projectsByClient.get(client.id) ?? [],
  }));
}

// weekOf is indexed (idx_week_items_week_of) — see runway-schema.ts
export async function getWeekItems(weekOf?: string): Promise<WeekDay[]> {
  const db = getRunwayDb();

  const clientNameById = await getClientNameMap();

  const items = weekOf
    ? await db
        .select()
        .from(weekItems)
        .where(eq(weekItems.weekOf, weekOf))
        .orderBy(asc(weekItems.date), asc(weekItems.sortOrder))
    : await db
        .select()
        .from(weekItems)
        .orderBy(asc(weekItems.date), asc(weekItems.sortOrder));

  return groupWeekItemsIntoDays(items, clientNameById);
}

export async function getPipeline(): Promise<PipelineRow[]> {
  const db = getRunwayDb();

  const clientNameById = await getClientNameMap();

  const items = await db
    .select()
    .from(pipelineItems)
    .orderBy(asc(pipelineItems.sortOrder));

  return items.map((item) => ({
    ...item,
    accountName: item.clientId ? (clientNameById.get(item.clientId) ?? null) : null,
  }));
}

/**
 * Get past-due week items (date before today) from the current week
 * and up to 3 previous weeks that have no corresponding update.
 * Items are grouped by date, sorted oldest first.
 */
export async function getStaleWeekItems(): Promise<WeekDay[]> {
  const db = getRunwayDb();
  const now = new Date();
  const todayISO = toISODateString(now);
  const mondayISO = getMondayISODate(now);

  // Look back 3 weeks max to bound the query
  const lookbackMonday = new Date(getMonday(now));
  lookbackMonday.setDate(lookbackMonday.getDate() - 21);
  const lookbackISO = toISODateString(lookbackMonday);

  const clientNameById = await getClientNameMap();

  // Get week items from current week and up to 3 previous weeks
  const allItems = await db
    .select()
    .from(weekItems)
    .where(and(gte(weekItems.weekOf, lookbackISO), lte(weekItems.weekOf, mondayISO)))
    .orderBy(asc(weekItems.date), asc(weekItems.sortOrder));

  // Filter to past days only, excluding completed items (v4: status-aware)
  const pastItems = allItems.filter(
    (item) => item.date != null && item.date < todayISO && item.status !== "completed"
  );
  if (pastItems.length === 0) return [];

  // Get all updates from this week to check for coverage
  const recentUpdates = await db
    .select()
    .from(updates)
    .orderBy(asc(updates.createdAt));

  // Build set of projectIds that have updates after their scheduled date
  const updatedProjectIds = new Set<string>();
  for (const update of recentUpdates) {
    if (!update.projectId || !update.createdAt) continue;
    for (const item of pastItems) {
      if (item.projectId === update.projectId) {
        const itemDate = parseISODate(item.date!);
        if (update.createdAt >= itemDate) {
          updatedProjectIds.add(update.projectId);
        }
      }
    }
  }

  // Filter to items without updates (items without projectId are always stale)
  const staleItems = pastItems.filter(
    (item) => !item.projectId || !updatedProjectIds.has(item.projectId)
  );
  if (staleItems.length === 0) return [];

  return groupWeekItemsIntoDays(staleItems, clientNameById);
}
