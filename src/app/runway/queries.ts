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

function mapWeekItemToEntry(
  item: WeekItemRow,
  clientNameById: Map<string, string>
): WeekDay["items"][number] {
  return {
    title: item.title,
    account: item.clientId ? (clientNameById.get(item.clientId) ?? "") : "",
    ...(item.owner ? { owner: item.owner } : {}),
    ...(item.resources ? { resources: item.resources } : {}),
    type: (item.category ?? "delivery") as DayItemType,
    ...(item.notes ? { notes: item.notes } : {}),
  };
}

function groupWeekItemsIntoDays(
  items: WeekItemRow[],
  clientNameById: Map<string, string>
): WeekDay[] {
  const grouped = groupBy(items, (item) => item.date ?? "");
  const sortedDates = [...grouped.keys()].sort();
  return sortedDates.map((dateStr) => ({
    date: dateStr,
    label: formatDayLabel(dateStr),
    items: (grouped.get(dateStr) ?? []).map((item) => mapWeekItemToEntry(item, clientNameById)),
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
