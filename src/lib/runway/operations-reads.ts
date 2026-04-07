/**
 * Runway Read Operations — data retrieval for MCP server and Slack bot
 *
 * All read operations that return formatted data for consumers.
 * Uses shared queries from operations.ts for client/project lookup.
 */

import { getRunwayDb } from "@/lib/db/runway";
import {
  projects,
  weekItems,
  pipelineItems,
} from "@/lib/db/runway-schema";
import { eq, asc } from "drizzle-orm";
import {
  getAllClients,
  getClientNameMap,
  groupBy,
  matchesSubstring,
} from "./operations";

export async function getClientsWithCounts() {
  const db = getRunwayDb();
  const allClients = await getAllClients();
  const allProjects = await db.select().from(projects);

  const projectsByClient = groupBy(allProjects, (p) => p.clientId);
  const countByClient = new Map(
    [...projectsByClient.entries()].map(([k, v]) => [k, v.length])
  );

  return allClients.map((c) => ({
    name: c.name,
    slug: c.slug,
    contractValue: c.contractValue,
    contractStatus: c.contractStatus,
    contractTerm: c.contractTerm,
    team: c.team,
    projectCount: countByClient.get(c.id) ?? 0,
  }));
}

export async function getProjectsFiltered(opts?: {
  clientSlug?: string;
  status?: string;
  owner?: string;
  waitingOn?: string;
}) {
  const db = getRunwayDb();
  const allClients = await getAllClients();
  const clientNameById = await getClientNameMap();
  const clientBySlug = new Map(allClients.map((c) => [c.slug, c]));

  let projectList = await db
    .select()
    .from(projects)
    .orderBy(asc(projects.sortOrder));

  if (opts?.clientSlug) {
    const client = clientBySlug.get(opts.clientSlug);
    if (client) {
      projectList = projectList.filter((p) => p.clientId === client.id);
    }
  }

  if (opts?.status) {
    projectList = projectList.filter((p) => p.status === opts.status);
  }

  if (opts?.owner) {
    projectList = projectList.filter((p) => matchesSubstring(p.owner, opts.owner!));
  }

  if (opts?.waitingOn) {
    projectList = projectList.filter((p) => matchesSubstring(p.waitingOn, opts.waitingOn!));
  }

  return projectList.map((p) => ({
    name: p.name,
    client: clientNameById.get(p.clientId) ?? "Unknown",
    status: p.status,
    category: p.category,
    owner: p.owner,
    waitingOn: p.waitingOn,
    target: p.target,
    notes: p.notes,
    staleDays: p.staleDays,
  }));
}

export async function getWeekItemsData(weekOf?: string, owner?: string) {
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

  return items.map((item) => ({
    date: item.date,
    dayOfWeek: item.dayOfWeek,
    title: item.title,
    account: item.clientId ? clientNameById.get(item.clientId) ?? null : null,
    category: item.category,
    owner: item.owner,
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
    (p) => matchesSubstring(p.owner, personName)
  );

  const allWeekItems = await db
    .select()
    .from(weekItems)
    .orderBy(asc(weekItems.date), asc(weekItems.sortOrder));

  const matchingWeekItems = allWeekItems.filter(
    (item) => matchesSubstring(item.owner, personName)
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

export async function getPipelineData() {
  const db = getRunwayDb();
  const clientNameById = await getClientNameMap();

  const items = await db
    .select()
    .from(pipelineItems)
    .orderBy(asc(pipelineItems.sortOrder));

  return items.map((item) => ({
    account: item.clientId
      ? clientNameById.get(item.clientId) ?? null
      : null,
    name: item.name,
    status: item.status,
    estimatedValue: item.estimatedValue,
    waitingOn: item.waitingOn,
    notes: item.notes,
  }));
}
