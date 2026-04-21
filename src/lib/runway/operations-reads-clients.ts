/**
 * Runway Read Operations — Client & Project queries
 */

import { getRunwayDb } from "@/lib/db/runway";
import { pipelineItems, projects, updates } from "@/lib/db/runway-schema";
import { asc, desc, eq } from "drizzle-orm";
import {
  getAllClients,
  getClientBySlug,
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
      notes: p.notes,
      staleDays: p.staleDays,
      dueDate: p.dueDate,
      startDate: p.startDate,
      endDate: p.endDate,
      engagementType: p.engagementType,
      contractStart: p.contractStart,
      contractEnd: p.contractEnd,
      // v4 convention (2026-04-21 / PR #88 Chunk F): retainer wrapper parent.
      parentProjectId: p.parentProjectId,
      updatedAt: p.updatedAt,
    }));
    return { ...base, projects: clientProjects };
  });
}

/**
 * Sentinel string used to match projects with NULL `engagement_type`. Passing
 * `engagementType: "__null__"` to `getProjectsFiltered` narrows to the
 * un-categorized engagements. All other string values are treated as exact
 * matches on the column. v4 convention (2026-04-21 / PR #88 Chunk B).
 */
export const ENGAGEMENT_TYPE_NULL_SENTINEL = "__null__";

/**
 * Sentinel string used to match projects with NULL `parent_project_id` --
 * i.e. top-level L1s that are not nested under a retainer wrapper. Passing
 * `parentProjectId: "__null__"` to `getProjectsFiltered` narrows to those
 * top-level projects. All other string values are treated as exact matches
 * on the column (e.g. filter to one wrapper's children). v4 convention
 * (2026-04-21 / PR #88 Chunk F).
 */
export const PARENT_PROJECT_ID_NULL_SENTINEL = "__null__";

export async function getProjectsFiltered(opts?: {
  clientSlug?: string;
  status?: string;
  owner?: string;
  waitingOn?: string;
  /**
   * Exact match on projects.engagement_type. Pass the sentinel
   * `ENGAGEMENT_TYPE_NULL_SENTINEL` ("__null__") to match rows where
   * engagement_type IS NULL.
   */
  engagementType?: string;
  /**
   * Exact match on projects.parent_project_id. Pass the sentinel
   * `PARENT_PROJECT_ID_NULL_SENTINEL` ("__null__") to match only
   * top-level L1s. Pass a specific id to list that wrapper's children.
   */
  parentProjectId?: string;
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

  if (opts?.engagementType) {
    projectList = opts.engagementType === ENGAGEMENT_TYPE_NULL_SENTINEL
      ? projectList.filter((p) => p.engagementType === null)
      : projectList.filter((p) => p.engagementType === opts.engagementType);
  }

  if (opts?.parentProjectId) {
    projectList = opts.parentProjectId === PARENT_PROJECT_ID_NULL_SENTINEL
      ? projectList.filter((p) => p.parentProjectId === null)
      : projectList.filter((p) => p.parentProjectId === opts.parentProjectId);
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
    // v4 convention (2026-04-21 / PR #88 Chunk F): retainer wrapper parent.
    parentProjectId: p.parentProjectId,
    updatedAt: p.updatedAt,
  }));
}

// ── getClientDetail: deep view for a single client ──────

export interface GetClientDetailOptions {
  /**
   * Cap on the recent-updates slice. Default 20.
   */
  recentUpdatesLimit?: number;
}

export interface ClientDetailProject {
  id: string;
  name: string;
  status: string | null;
  category: string | null;
  owner: string | null;
  resources: string | null;
  waitingOn: string | null;
  notes: string | null;
  staleDays: number | null;
  dueDate: string | null;
  startDate: string | null;
  endDate: string | null;
  engagementType: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  /** v4 (PR #88 Chunk F): retainer wrapper parent id, null for top-level L1s. */
  parentProjectId: string | null;
  updatedAt: Date;
}

export interface ClientDetailPipelineItem {
  id: string;
  name: string;
  status: string | null;
  owner: string | null;
  estimatedValue: string | null;
  waitingOn: string | null;
  notes: string | null;
  updatedAt: Date;
}

export interface ClientDetailUpdate {
  id: string;
  projectId: string | null;
  updatedBy: string | null;
  updateType: string | null;
  summary: string | null;
  previousValue: string | null;
  newValue: string | null;
  batchId: string | null;
  createdAt: Date | null;
}

export interface ClientDetail {
  id: string;
  name: string;
  slug: string;
  nicknames: string | null;
  contractValue: string | null;
  contractTerm: string | null;
  contractStatus: string | null;
  team: string | null;
  clientContacts: string | null;
  createdAt: Date;
  updatedAt: Date;
  projects: ClientDetailProject[];
  pipelineItems: ClientDetailPipelineItem[];
  recentUpdates: ClientDetailUpdate[];
}

/**
 * Deep view for a single client. Returns null when the slug is unknown.
 *
 * Batches the projects / pipeline / updates fetches through Promise.all()
 * after slug→id resolution, per the project's parallel-fetching pattern.
 * Output includes full v4-enriched project rows, the client's pipeline
 * items, and the N most recent audit updates.
 *
 * v4 convention (2026-04-21). Used by MCP + bot "drill into client" flows.
 */
export async function getClientDetail(
  slug: string,
  opts: GetClientDetailOptions = {}
): Promise<ClientDetail | null> {
  const { recentUpdatesLimit = 20 } = opts;
  const client = await getClientBySlug(slug);
  if (!client) return null;

  const db = getRunwayDb();

  // Parallel fan-out — projects, pipeline, and updates are independent
  // queries scoped to this client. Matches MEMORY.md "batch query
  // optimization" pattern and the server-parallel-fetching best practice.
  const [clientProjects, clientPipeline, clientUpdates] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(eq(projects.clientId, client.id))
      .orderBy(asc(projects.sortOrder)),
    db
      .select()
      .from(pipelineItems)
      .where(eq(pipelineItems.clientId, client.id))
      .orderBy(asc(pipelineItems.sortOrder)),
    db
      .select()
      .from(updates)
      .where(eq(updates.clientId, client.id))
      .orderBy(desc(updates.createdAt))
      .limit(recentUpdatesLimit),
  ]);

  return {
    id: client.id,
    name: client.name,
    slug: client.slug,
    nicknames: client.nicknames,
    contractValue: client.contractValue,
    contractTerm: client.contractTerm,
    contractStatus: client.contractStatus,
    team: client.team,
    clientContacts: client.clientContacts,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    projects: clientProjects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      category: p.category,
      owner: p.owner,
      resources: p.resources,
      waitingOn: p.waitingOn,
      notes: p.notes,
      staleDays: p.staleDays,
      dueDate: p.dueDate,
      startDate: p.startDate,
      endDate: p.endDate,
      engagementType: p.engagementType,
      contractStart: p.contractStart,
      contractEnd: p.contractEnd,
      parentProjectId: p.parentProjectId,
      updatedAt: p.updatedAt,
    })),
    pipelineItems: clientPipeline.map((pi) => ({
      id: pi.id,
      name: pi.name,
      status: pi.status,
      owner: pi.owner,
      estimatedValue: pi.estimatedValue,
      waitingOn: pi.waitingOn,
      notes: pi.notes,
      updatedAt: pi.updatedAt,
    })),
    recentUpdates: clientUpdates.map((u) => ({
      id: u.id,
      projectId: u.projectId,
      updatedBy: u.updatedBy,
      updateType: u.updateType,
      summary: u.summary,
      previousValue: u.previousValue,
      newValue: u.newValue,
      batchId: u.batchId,
      createdAt: u.createdAt,
    })),
  };
}
