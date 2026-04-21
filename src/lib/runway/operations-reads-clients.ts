/**
 * Runway Read Operations — Client & Project queries
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects } from "@/lib/db/runway-schema";
import { asc } from "drizzle-orm";
import {
  getAllClients,
  getClientNameMap,
  groupBy,
  matchesSubstring,
} from "./operations";

export interface GetClientsWithCountsOptions {
  /**
   * When true, include a nested `projects` array per client using the same
   * enriched shape returned by `getProjectsFiltered`. Default false to keep
   * the minimal shape for bot listings. v4 convention (2026-04-21).
   */
  includeProjects?: boolean;
}

export async function getClientsWithCounts(opts?: GetClientsWithCountsOptions) {
  const db = getRunwayDb();
  const allClients = await getAllClients();
  const allProjects = await db.select().from(projects);

  const projectsByClient = groupBy(allProjects, (p) => p.clientId);
  const countByClient = new Map(
    [...projectsByClient.entries()].map(([k, v]) => [k, v.length])
  );

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));

  const includeProjects = opts?.includeProjects ?? false;

  return allClients.map((c) => {
    const base = {
      id: c.id,
      name: c.name,
      slug: c.slug,
      contractValue: c.contractValue,
      contractStatus: c.contractStatus,
      contractTerm: c.contractTerm,
      team: c.team,
      projectCount: countByClient.get(c.id) ?? 0,
      updatedAt: c.updatedAt,
    };
    if (!includeProjects) return base;

    const clientProjects = (projectsByClient.get(c.id) ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      client: clientNameById.get(p.clientId) ?? "Unknown",
      status: p.status,
      category: p.category,
      owner: p.owner,
      resources: p.resources,
      waitingOn: p.waitingOn,
      target: p.target,
      notes: p.notes,
      staleDays: p.staleDays,
      dueDate: p.dueDate,
      startDate: p.startDate,
      endDate: p.endDate,
      engagementType: p.engagementType,
      contractStart: p.contractStart,
      contractEnd: p.contractEnd,
      updatedAt: p.updatedAt,
    }));
    return { ...base, projects: clientProjects };
  });
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
    id: p.id,
    name: p.name,
    client: clientNameById.get(p.clientId) ?? "Unknown",
    status: p.status,
    category: p.category,
    owner: p.owner,
    resources: p.resources,
    waitingOn: p.waitingOn,
    target: p.target,
    notes: p.notes,
    staleDays: p.staleDays,
    // v4 convention (2026-04-21): enriched timing + engagement fields for
    // MCP + bot consumers. All nullable; existing callers ignore unknown keys.
    dueDate: p.dueDate,
    startDate: p.startDate,
    endDate: p.endDate,
    engagementType: p.engagementType,
    contractStart: p.contractStart,
    contractEnd: p.contractEnd,
    updatedAt: p.updatedAt,
  }));
}
