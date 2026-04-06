import { getRunwayDb } from "@/lib/db/runway";
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
  teamMembers,
} from "@/lib/db/runway-schema";
import { eq, asc } from "drizzle-orm";
import type { ClientWithProjects, DayItemType, PipelineRow, WeekDay } from "./types";
import { parseISODate } from "./date-utils";
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

export async function getTeamMembers() {
  const db = getRunwayDb();
  return db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.isActive, 1));
}
