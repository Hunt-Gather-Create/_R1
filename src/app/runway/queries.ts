import { getRunwayDb } from "@/lib/db/runway";
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
  teamMembers,
  updates,
} from "@/lib/db/runway-schema";
import { eq, asc } from "drizzle-orm";
import type { ClientWithProjects, DayItemType, PipelineRow, WeekDay } from "./types";
import { parseISODate, getMondayISODate } from "./date-utils";
import { getClientNameMap, groupBy } from "@/lib/runway/operations";

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

  // Group by date and map to UI shape
  const grouped = groupBy(items, (item) => item.date ?? "");
  const dayMap = new Map<string, WeekDay["items"]>();
  for (const [dateKey, dayItems] of grouped) {
    dayMap.set(
      dateKey,
      dayItems.map((item) => ({
        title: item.title,
        account: item.clientId ? (clientNameById.get(item.clientId) ?? "") : "",
        ...(item.owner ? { owner: item.owner } : {}),
        type: (item.category ?? "delivery") as DayItemType,
        ...(item.notes ? { notes: item.notes } : {}),
      }))
    );
  }

  // Sort dates and format labels
  const sortedDates = [...dayMap.keys()].sort();

  return sortedDates.map((dateStr) => {
    const d = parseISODate(dateStr);
    const dayNum = d.getDate();
    const month = d.getMonth() + 1;
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const label = `${dayNames[d.getDay()]} ${month}/${dayNum}`;

    return {
      date: dateStr,
      label,
      items: dayMap.get(dateStr) ?? [],
    };
  });
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
 * Get week items from previous days (before today) in the current week
 * that have no corresponding update since their scheduled date.
 * Items are grouped by date, sorted oldest first.
 */
export async function getStaleWeekItems(): Promise<WeekDay[]> {
  const db = getRunwayDb();
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const mondayISO = getMondayISODate(now);

  const clientNameById = await getClientNameMap();

  // Get all week items for the current week
  const allItems = await db
    .select()
    .from(weekItems)
    .where(eq(weekItems.weekOf, mondayISO))
    .orderBy(asc(weekItems.date), asc(weekItems.sortOrder));

  // Filter to past days only
  const pastItems = allItems.filter((item) => item.date != null && item.date < todayISO);
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

  // Group by date and format (same pattern as getWeekItems)
  const grouped = groupBy(staleItems, (item) => item.date ?? "");
  const sortedDates = [...grouped.keys()].sort();

  return sortedDates.map((dateStr) => {
    const d = parseISODate(dateStr);
    const dayNum = d.getDate();
    const month = d.getMonth() + 1;
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const label = `${dayNames[d.getDay()]} ${month}/${dayNum}`;

    const items = grouped.get(dateStr) ?? [];
    return {
      date: dateStr,
      label,
      items: items.map((item) => ({
        title: item.title,
        account: item.clientId ? (clientNameById.get(item.clientId) ?? "") : "",
        ...(item.owner ? { owner: item.owner } : {}),
        type: (item.category ?? "delivery") as DayItemType,
        ...(item.notes ? { notes: item.notes } : {}),
      })),
    };
  });
}

export async function getTeamMembers() {
  const db = getRunwayDb();
  return db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.isActive, 1));
}
