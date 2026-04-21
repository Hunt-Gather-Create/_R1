/**
 * Runway Read Operations — recent updates query
 *
 * Powers "what did I update?" and "what happened with X this week?" queries.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { updates, projects, clients } from "@/lib/db/runway-schema";
import { desc } from "drizzle-orm";
import { matchesSubstring, getClientBySlug } from "./operations-utils";

export interface RecentUpdate {
  clientName: string | null;
  projectName: string | null;
  updateType: string | null;
  summary: string | null;
  previousValue: string | null;
  newValue: string | null;
  createdAt: Date | null;
}

export interface GetRecentUpdatesParams {
  updatedBy?: string;
  clientSlug?: string;
  since?: string; // ISO date
  limit?: number;
}

export async function getRecentUpdates(
  params: GetRecentUpdatesParams = {}
): Promise<RecentUpdate[]> {
  const {
    updatedBy,
    clientSlug,
    since,
    limit = 20,
  } = params;

  const db = getRunwayDb();

  // Build a project name map
  const allProjects = await db.select().from(projects);
  const projectNameMap = new Map(allProjects.map((p) => [p.id, p.name]));

  // Build a client name map
  const allClients = await db.select().from(clients);
  const clientNameMap = new Map(allClients.map((c) => [c.id, c.name]));

  // Get client ID filter if clientSlug provided
  let clientIdFilter: string | undefined;
  if (clientSlug) {
    const client = await getClientBySlug(clientSlug);
    if (client) clientIdFilter = client.id;
  }

  // Compute since date
  const sinceDate = since
    ? new Date(since)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Query all recent updates, then filter in JS for flexibility
  const allUpdates = await db
    .select()
    .from(updates)
    .orderBy(desc(updates.createdAt));

  const results: RecentUpdate[] = [];

  for (const u of allUpdates) {
    if (results.length >= limit) break;

    // Filter by date
    if (u.createdAt && u.createdAt < sinceDate) break; // ordered desc, so stop early

    // Filter by updatedBy (substring match)
    if (updatedBy && !matchesSubstring(u.updatedBy, updatedBy)) continue;

    // Filter by client
    if (clientIdFilter && u.clientId !== clientIdFilter) continue;

    results.push({
      clientName: u.clientId ? clientNameMap.get(u.clientId) ?? null : null,
      projectName: u.projectId ? projectNameMap.get(u.projectId) ?? null : null,
      updateType: u.updateType,
      summary: u.summary,
      previousValue: u.previousValue ?? null,
      newValue: u.newValue ?? null,
      createdAt: u.createdAt,
    });
  }

  return results;
}

// ── findUpdates: audit-trail search ──────────────────────

/**
 * Richer row for `findUpdates` — includes fields callers need when walking
 * the audit trail (id, updatedBy, batchId, triggeredByUpdateId).
 */
export interface AuditUpdate {
  id: string;
  clientName: string | null;
  projectName: string | null;
  updatedBy: string | null;
  updateType: string | null;
  summary: string | null;
  previousValue: string | null;
  newValue: string | null;
  batchId: string | null;
  triggeredByUpdateId: string | null;
  createdAt: Date | null;
}

export interface FindUpdatesParams {
  /** Inclusive lower bound on createdAt (ISO). */
  since?: string;
  /** Inclusive upper bound on createdAt (ISO). */
  until?: string;
  clientSlug?: string;
  /** Case-insensitive substring match against updates.updated_by. */
  updatedBy?: string;
  /** Exact match on updates.update_type. */
  updateType?: string;
  /** Exact match on updates.batch_id. */
  batchId?: string;
  /** Case-insensitive substring match against the linked project's name. */
  projectName?: string;
  /** Hard cap on returned rows. Default 100. */
  limit?: number;
}

/**
 * Generic audit-trail search over the updates table. All filters optional.
 *
 * v4 convention (2026-04-21). Complements `getUpdatesData` (which is tuned
 * for bot-style recent-activity summaries) by exposing the full audit row —
 * id, batch context, and cascade parent — so callers can follow chains and
 * reconcile batches.
 */
export async function findUpdates(
  params: FindUpdatesParams = {}
): Promise<AuditUpdate[]> {
  const {
    since,
    until,
    clientSlug,
    updatedBy,
    updateType,
    batchId,
    projectName,
    limit = 100,
  } = params;

  const db = getRunwayDb();

  const [allProjects, allClients, allUpdates] = await Promise.all([
    db.select().from(projects),
    db.select().from(clients),
    db.select().from(updates).orderBy(desc(updates.createdAt)),
  ]);

  const projectNameMap = new Map(allProjects.map((p) => [p.id, p.name]));
  const clientNameMap = new Map(allClients.map((c) => [c.id, c.name]));

  let clientIdFilter: string | undefined;
  if (clientSlug) {
    const client = await getClientBySlug(clientSlug);
    if (!client) return [];
    clientIdFilter = client.id;
  }

  const sinceDate = since ? new Date(since) : null;
  const untilDate = until ? new Date(until) : null;

  const results: AuditUpdate[] = [];
  for (const u of allUpdates) {
    if (results.length >= limit) break;

    // Rows are ordered desc by createdAt: once we dip below `since`, we
    // can't find any more valid rows. Stop early.
    if (sinceDate && u.createdAt && u.createdAt < sinceDate) break;

    if (untilDate && u.createdAt && u.createdAt > untilDate) continue;
    if (clientIdFilter && u.clientId !== clientIdFilter) continue;
    if (updatedBy && !matchesSubstring(u.updatedBy, updatedBy)) continue;
    if (updateType && u.updateType !== updateType) continue;
    if (batchId && u.batchId !== batchId) continue;
    if (projectName) {
      if (!u.projectId) continue;
      if (!matchesSubstring(projectNameMap.get(u.projectId), projectName)) continue;
    }

    results.push({
      id: u.id,
      clientName: u.clientId ? clientNameMap.get(u.clientId) ?? null : null,
      projectName: u.projectId ? projectNameMap.get(u.projectId) ?? null : null,
      updatedBy: u.updatedBy,
      updateType: u.updateType,
      summary: u.summary,
      previousValue: u.previousValue ?? null,
      newValue: u.newValue ?? null,
      batchId: u.batchId ?? null,
      triggeredByUpdateId: u.triggeredByUpdateId ?? null,
      createdAt: u.createdAt,
    });
  }

  return results;
}

// ── getUpdateChain: follow cascade linkage ───────────────

export interface UpdateChain {
  /** Root update — ancestor with no `triggeredByUpdateId`. Null when the
   *  requested update itself is missing or has a broken chain. */
  root: AuditUpdate | null;
  /** Every update in the chain, ordered by createdAt ASC. Includes root. */
  chain: AuditUpdate[];
}

function toAuditUpdate(
  u: typeof updates.$inferSelect,
  projectNameMap: Map<string, string>,
  clientNameMap: Map<string, string>
): AuditUpdate {
  return {
    id: u.id,
    clientName: u.clientId ? clientNameMap.get(u.clientId) ?? null : null,
    projectName: u.projectId ? projectNameMap.get(u.projectId) ?? null : null,
    updatedBy: u.updatedBy,
    updateType: u.updateType,
    summary: u.summary,
    previousValue: u.previousValue ?? null,
    newValue: u.newValue ?? null,
    batchId: u.batchId ?? null,
    triggeredByUpdateId: u.triggeredByUpdateId ?? null,
    createdAt: u.createdAt,
  };
}

/**
 * Walk the cascade audit linkage for a given update. Returns the root
 * ancestor + every descendant in chronological order (ASC by createdAt).
 *
 * Cascade rows chain via `updates.triggered_by_update_id` — a nullable
 * self-reference. The root is the ancestor with no parent; from that root we
 * walk down all descendants across the tree.
 *
 * If `updateId` is missing or unreachable, returns `{ root: null, chain: [] }`.
 *
 * v4 convention (2026-04-21).
 */
export async function getUpdateChain(updateId: string): Promise<UpdateChain> {
  const db = getRunwayDb();

  // Fetch name maps + the starting row in parallel. The chain walk needs
  // repeated single-row lookups, which we satisfy via a single full scan of
  // `updates` kept in memory — cheap at current volume and O(1) per hop.
  const [allProjects, allClients, allUpdates] = await Promise.all([
    db.select().from(projects),
    db.select().from(clients),
    db.select().from(updates),
  ]);

  const projectNameMap = new Map(allProjects.map((p) => [p.id, p.name]));
  const clientNameMap = new Map(allClients.map((c) => [c.id, c.name]));
  const byId = new Map(allUpdates.map((u) => [u.id, u]));

  const start = byId.get(updateId);
  if (!start) return { root: null, chain: [] };

  // Walk up to the root via triggeredByUpdateId.
  let current: typeof updates.$inferSelect | undefined = start;
  const visited = new Set<string>();
  while (current?.triggeredByUpdateId) {
    if (visited.has(current.id)) break; // defensive cycle guard
    visited.add(current.id);
    const parent = byId.get(current.triggeredByUpdateId);
    if (!parent) break;
    current = parent;
  }
  const rootRow = current ?? start;

  // BFS descendants — collect every row whose triggered_by chain leads back
  // to the root. Start from the root, expand children by scanning.
  const childrenByParent = new Map<string, typeof updates.$inferSelect[]>();
  for (const u of allUpdates) {
    if (!u.triggeredByUpdateId) continue;
    const list = childrenByParent.get(u.triggeredByUpdateId) ?? [];
    list.push(u);
    childrenByParent.set(u.triggeredByUpdateId, list);
  }

  const chainRows: typeof updates.$inferSelect[] = [rootRow];
  const queue: string[] = [rootRow.id];
  const seenInChain = new Set<string>([rootRow.id]);
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const kids = childrenByParent.get(parentId) ?? [];
    for (const kid of kids) {
      if (seenInChain.has(kid.id)) continue;
      seenInChain.add(kid.id);
      chainRows.push(kid);
      queue.push(kid.id);
    }
  }

  // Sort ASC by createdAt (nulls last) for a readable chain.
  chainRows.sort((a, b) => {
    const aTs = a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTs = b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTs - bTs;
  });

  const chain = chainRows.map((u) => toAuditUpdate(u, projectNameMap, clientNameMap));
  const root = toAuditUpdate(rootRow, projectNameMap, clientNameMap);

  return { root, chain };
}
