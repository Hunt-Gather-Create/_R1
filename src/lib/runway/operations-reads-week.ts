/**
 * Runway Read Operations — Week Items & Workload queries
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, weekItems } from "@/lib/db/runway-schema";
import { and, asc, eq } from "drizzle-orm";
import {
  getClientNameMap,
  groupBy,
  matchesSubstring,
} from "./operations";

export type WeekItemRow = typeof weekItems.$inferSelect;

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

export async function getPersonWorkload(personName: string) {
  const db = getRunwayDb();
  const clientNameById = await getClientNameMap();
  const allProjects = await db
    .select()
    .from(projects)
    .orderBy(asc(projects.sortOrder));

  const matchingProjects = allProjects.filter(
    (p) => matchesSubstring(p.owner, personName) || matchesSubstring(p.resources, personName)
  );

  const allWeekItems = await db
    .select()
    .from(weekItems)
    .orderBy(asc(weekItems.date), asc(weekItems.sortOrder));

  const matchingWeekItems = allWeekItems.filter(
    (item) => matchesSubstring(item.owner, personName) || matchesSubstring(item.resources, personName)
  );

  // Group projects by client
  const projectsByClient = groupBy(matchingProjects, (p) => p.clientId);
  const projectGroups = [...projectsByClient.entries()].map(([clientId, items]) => ({
    client: clientNameById.get(clientId) ?? "Unknown",
    projects: items.map((p) => ({
      name: p.name,
      status: p.status,
      target: p.target,
      notes: p.notes,
    })),
  }));

  // Group week items by client
  const weekByClient = groupBy(matchingWeekItems, (item) => item.clientId ?? "none");
  const weekGroups = [...weekByClient.entries()].map(([clientId, items]) => ({
    client: clientId === "none" ? "Unassigned" : (clientNameById.get(clientId) ?? "Unknown"),
    items: items.map((item) => ({
      date: item.date,
      title: item.title,
      category: item.category,
      notes: item.notes,
    })),
  }));

  return {
    person: personName,
    projects: projectGroups,
    weekItems: weekGroups,
    totalProjects: matchingProjects.length,
    totalWeekItems: matchingWeekItems.length,
  };
}
