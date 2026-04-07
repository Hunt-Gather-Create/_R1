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
  updates,
} from "@/lib/db/runway-schema";
import { eq, asc, desc } from "drizzle-orm";
import {
  getAllClients,
  getClientBySlug,
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

export interface StaleAccountItem {
  clientName: string;
  projectName: string;
  staleDays: number;
  lastUpdate?: string;
}

/**
 * Find stale projects for a set of client slugs.
 * A project is stale if staleDays >= 7 or it has no updates in the last 7 days.
 * Results are sorted by staleness (most stale first).
 */
export async function getStaleItemsForAccounts(
  clientSlugs: string[]
): Promise<StaleAccountItem[]> {
  if (clientSlugs.length === 0) return [];

  const db = getRunwayDb();
  const results: StaleAccountItem[] = [];

  for (const slug of clientSlugs) {
    const client = await getClientBySlug(slug);
    if (!client) continue;

    const clientProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.clientId, client.id))
      .orderBy(asc(projects.sortOrder));

    // Get most recent update per project for this client
    const clientUpdates = await db
      .select()
      .from(updates)
      .where(eq(updates.clientId, client.id))
      .orderBy(desc(updates.createdAt));

    const latestUpdateByProject = new Map<string, Date>();
    for (const u of clientUpdates) {
      if (u.projectId && u.createdAt && !latestUpdateByProject.has(u.projectId)) {
        latestUpdateByProject.set(u.projectId, u.createdAt);
      }
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    for (const project of clientProjects) {
      // Skip completed projects
      if (project.status === "completed") continue;

      const isStaleByStaleDays = project.staleDays != null && project.staleDays >= 7;
      const lastUpdate = latestUpdateByProject.get(project.id);
      const isStaleByUpdates = !lastUpdate || lastUpdate < sevenDaysAgo;

      if (isStaleByStaleDays || isStaleByUpdates) {
        results.push({
          clientName: client.name,
          projectName: project.name,
          staleDays: project.staleDays ?? 0,
          lastUpdate: lastUpdate?.toISOString(),
        });
      }
    }
  }

  results.sort((a, b) => b.staleDays - a.staleDays);
  return results;
}
