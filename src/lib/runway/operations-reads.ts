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
} from "./operations";

export async function getClientsWithCounts() {
  const db = getRunwayDb();
  const allClients = await getAllClients();
  const allProjects = await db.select().from(projects);

  const countByClient = new Map<string, number>();
  for (const p of allProjects) {
    countByClient.set(
      p.clientId,
      (countByClient.get(p.clientId) ?? 0) + 1
    );
  }

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
}) {
  const db = getRunwayDb();
  const allClients = await getAllClients();
  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));
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

export async function getWeekItemsData(weekOf?: string) {
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
