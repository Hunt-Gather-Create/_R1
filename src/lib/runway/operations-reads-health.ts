/**
 * Runway Read Operations — Observability & health snapshots.
 *
 * These functions surface data-integrity signals and audit-log structure so
 * the bot / MCP surface can answer questions like:
 *   - "Is everything linked correctly?" (orphans)
 *   - "What's the current batch?" (active batch id + contents)
 *   - "What cascades fired in the last hour?" (cascade fan-out)
 *
 * All functions are pure reads — they never write to `updates` or any other
 * table. Safe to call frequently.
 *
 * Stale / past-end predicates here mirror the semantics of
 * `flags-detectors.ts::detectStaleItems` (STALE_EXCLUDED_STATUSES) and
 * `flags-detectors.ts::isPastEndInProgress`. Kept as raw-row predicates here
 * because the detector variants require plate-domain `Account[]`/`DayItem[]`
 * shapes, and this file operates on raw DB rows.
 */

import { getRunwayDb } from "@/lib/db/runway";
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
  updates,
} from "@/lib/db/runway-schema";
import { eq, gte } from "drizzle-orm";
import { getBatchId, getClientBySlug } from "./operations-utils";

// Raw-row types for drift detection output.
type ProjectRow = typeof projects.$inferSelect;
type WeekItemRow = typeof weekItems.$inferSelect;
type ClientRow = typeof clients.$inferSelect;
type PipelineItemRow = typeof pipelineItems.$inferSelect;

// ── Shared helpers ──────────────────────────────────────

/** Statuses excluded from the stale-project count (match flags-detectors.ts:73). */
const STALE_EXCLUDED_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "on-hold",
]);

/** Return today's date as an ISO YYYY-MM-DD string in UTC. */
function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── getCurrentBatch ─────────────────────────────────────

/**
 * Result of `getCurrentBatch()`. When `active === false` no other fields are
 * populated, so callers can narrow on `active` and read batch details safely.
 */
export type CurrentBatch =
  | { active: false }
  | {
      active: true;
      batchId: string;
      /** Number of audit rows written under this batch id so far. */
      itemCount: number;
      /** Earliest createdAt of the rows in this batch (null if no rows yet). */
      startedAt: Date | null;
      /** updatedBy of the earliest row (best-effort since no real `startedBy` is tracked). */
      startedBy: string | null;
      /** Latest createdAt of the rows in this batch. */
      mostRecentAt: Date | null;
    };

/**
 * Return info about the currently-active batch for this process.
 *
 * The batch id lives in module-level state inside `operations-utils`
 * (`setBatchId` / `getBatchId`) — it is per-process, not persisted in the
 * DB. So this observability answers "is THIS process currently batching?".
 * When active, we enrich from the updates table: count, earliest/latest
 * timestamps, and the updater of the earliest row.
 */
export async function getCurrentBatch(): Promise<CurrentBatch> {
  const batchId = getBatchId();
  if (!batchId) return { active: false };

  const db = getRunwayDb();
  const rows = await db
    .select()
    .from(updates)
    .where(eq(updates.batchId, batchId));

  let startedAt: Date | null = null;
  let mostRecentAt: Date | null = null;
  let startedBy: string | null = null;
  for (const r of rows) {
    if (!r.createdAt) continue;
    if (!startedAt || r.createdAt < startedAt) {
      startedAt = r.createdAt;
      startedBy = r.updatedBy ?? null;
    }
    if (!mostRecentAt || r.createdAt > mostRecentAt) {
      mostRecentAt = r.createdAt;
    }
  }

  return {
    active: true,
    batchId,
    itemCount: rows.length,
    startedAt,
    startedBy,
    mostRecentAt,
  };
}

// ── getBatchContents ────────────────────────────────────

export interface BatchUpdateEntry {
  id: string;
  clientName: string | null;
  projectName: string | null;
  updateType: string | null;
  summary: string | null;
  updatedBy: string | null;
  createdAt: Date | null;
}

export interface BatchContentsGroup {
  clientName: string | null;
  projectName: string | null;
  updates: BatchUpdateEntry[];
}

export interface BatchContents {
  batchId: string;
  totalUpdates: number;
  /** Groups ordered by (clientName, projectName). Within a group, updates
   *  are ordered by createdAt ascending so the caller sees the sequence. */
  groups: BatchContentsGroup[];
}

/**
 * Return all audit rows tagged with the given batch id, grouped by
 * (client, project) for readability. Uses in-memory joins via name maps
 * to avoid N+1 lookups.
 */
export async function getBatchContents(batchId: string): Promise<BatchContents> {
  const db = getRunwayDb();

  const [rows, allProjects, allClients] = await Promise.all([
    db.select().from(updates).where(eq(updates.batchId, batchId)),
    db.select().from(projects),
    db.select().from(clients),
  ]);

  const projectNameMap = new Map(allProjects.map((p) => [p.id, p.name]));
  const clientNameMap = new Map(allClients.map((c) => [c.id, c.name]));

  const groupKey = (clientName: string | null, projectName: string | null) =>
    `${clientName ?? ""}::${projectName ?? ""}`;

  const groupMap = new Map<string, BatchContentsGroup>();

  for (const r of rows) {
    const clientName = r.clientId ? clientNameMap.get(r.clientId) ?? null : null;
    const projectName = r.projectId ? projectNameMap.get(r.projectId) ?? null : null;
    const key = groupKey(clientName, projectName);
    let group = groupMap.get(key);
    if (!group) {
      group = { clientName, projectName, updates: [] };
      groupMap.set(key, group);
    }
    group.updates.push({
      id: r.id,
      clientName,
      projectName,
      updateType: r.updateType,
      summary: r.summary,
      updatedBy: r.updatedBy,
      createdAt: r.createdAt,
    });
  }

  const groups = [...groupMap.values()];
  // Sort groups: client name asc (null last), then project name asc (null last).
  groups.sort((a, b) => {
    const ca = a.clientName ?? "\uFFFF";
    const cb = b.clientName ?? "\uFFFF";
    if (ca !== cb) return ca.localeCompare(cb);
    const pa = a.projectName ?? "\uFFFF";
    const pb = b.projectName ?? "\uFFFF";
    return pa.localeCompare(pb);
  });
  // Sort entries within each group by createdAt ascending (nulls last).
  for (const g of groups) {
    g.updates.sort((a, b) => {
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  return {
    batchId,
    totalUpdates: rows.length,
    groups,
  };
}

// ── getCascadeLog ───────────────────────────────────────

export interface CascadeParent {
  id: string;
  updateType: string | null;
  summary: string | null;
  clientName: string | null;
  projectName: string | null;
  createdAt: Date | null;
}

export interface CascadeChildEntry {
  id: string;
  updateType: string | null;
  summary: string | null;
  clientName: string | null;
  projectName: string | null;
  createdAt: Date | null;
}

export interface CascadeLogGroup {
  /** The triggeredByUpdateId of these children. null when cascade rows have no parent set. */
  parentUpdateId: string | null;
  /** Resolved parent update, or null when the parent is missing (dangling) or unknown. */
  parent: CascadeParent | null;
  children: CascadeChildEntry[];
}

export interface CascadeLog {
  windowMinutes: number;
  since: Date;
  totalCascadeRows: number;
  /** Groups ordered by most recent child createdAt, descending. */
  groups: CascadeLogGroup[];
}

const DEFAULT_CASCADE_WINDOW_MINUTES = 60;

/**
 * Return recent cascade-generated audit rows (updateType starting with
 * `cascade-`) within the given time window, grouped by their parent update
 * id so the caller sees the full cascade fan-out.
 *
 * Default window: 60 minutes. Accepts `null` / `undefined` via the usual
 * optional-param default.
 */
export async function getCascadeLog(
  windowMinutes?: number
): Promise<CascadeLog> {
  const minutes = windowMinutes ?? DEFAULT_CASCADE_WINDOW_MINUTES;
  const since = new Date(Date.now() - minutes * 60 * 1000);

  const db = getRunwayDb();
  const [allUpdates, allProjects, allClients] = await Promise.all([
    db.select().from(updates),
    db.select().from(projects),
    db.select().from(clients),
  ]);

  const projectNameMap = new Map(allProjects.map((p) => [p.id, p.name]));
  const clientNameMap = new Map(allClients.map((c) => [c.id, c.name]));
  const updateById = new Map(allUpdates.map((u) => [u.id, u]));

  const cascadeRows = allUpdates.filter(
    (u) =>
      u.updateType != null &&
      u.updateType.startsWith("cascade-") &&
      u.createdAt != null &&
      u.createdAt >= since
  );

  const resolveNames = (clientId: string | null, projectId: string | null) => ({
    clientName: clientId ? clientNameMap.get(clientId) ?? null : null,
    projectName: projectId ? projectNameMap.get(projectId) ?? null : null,
  });

  const groupMap = new Map<string, CascadeLogGroup>();
  const parentKey = (pid: string | null) => pid ?? "__null__";

  for (const row of cascadeRows) {
    const pid = row.triggeredByUpdateId ?? null;
    const key = parentKey(pid);
    let group = groupMap.get(key);
    if (!group) {
      let parent: CascadeParent | null = null;
      if (pid) {
        const parentRow = updateById.get(pid);
        if (parentRow) {
          const { clientName, projectName } = resolveNames(
            parentRow.clientId,
            parentRow.projectId
          );
          parent = {
            id: parentRow.id,
            updateType: parentRow.updateType,
            summary: parentRow.summary,
            clientName,
            projectName,
            createdAt: parentRow.createdAt,
          };
        }
      }
      group = { parentUpdateId: pid, parent, children: [] };
      groupMap.set(key, group);
    }
    const { clientName, projectName } = resolveNames(row.clientId, row.projectId);
    group.children.push({
      id: row.id,
      updateType: row.updateType,
      summary: row.summary,
      clientName,
      projectName,
      createdAt: row.createdAt,
    });
  }

  // Sort children within each group by createdAt ascending.
  const groups = [...groupMap.values()];
  for (const g of groups) {
    g.children.sort((a, b) => {
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }
  // Sort groups by most-recent child createdAt descending so the caller
  // sees the freshest cascades first.
  groups.sort((a, b) => {
    const aMax = a.children.reduce<number>(
      (m, c) => Math.max(m, c.createdAt?.getTime() ?? 0),
      0
    );
    const bMax = b.children.reduce<number>(
      (m, c) => Math.max(m, c.createdAt?.getTime() ?? 0),
      0
    );
    return bMax - aMax;
  });

  return {
    windowMinutes: minutes,
    since,
    totalCascadeRows: cascadeRows.length,
    groups,
  };
}

// ── getDataHealth ───────────────────────────────────────

export interface DataHealthTotals {
  projects: number;
  weekItems: number;
  clients: number;
  updates: number;
  pipelineItems: number;
}

export interface DataHealthOrphans {
  /** week_items with null projectId. */
  weekItemsWithoutProject: number;
  /** projects with null clientId. Schema requires notNull so expected 0. */
  projectsWithoutClient: number;
  /** updates whose triggeredByUpdateId references a non-existent update row. */
  updatesWithDanglingTriggeredBy: number;
}

export interface DataHealthStale {
  /** Projects with staleDays >= 14, excluding completed/on-hold. */
  staleProjects: number;
  /** Week items in-progress past their end/start date. */
  pastEndL2s: number;
}

export interface DataHealthBatch {
  /** Current in-memory batch id for this process, or null if not batching. */
  activeBatchId: string | null;
  /** Distinct batch ids seen in the updates table in the last 7 days. */
  distinctBatchIdsLast7Days: number;
}

export interface DataHealth {
  totals: DataHealthTotals;
  orphans: DataHealthOrphans;
  stale: DataHealthStale;
  batch: DataHealthBatch;
  /** Most recent updates.createdAt, or null if no audit rows exist. */
  lastUpdateAt: Date | null;
}

/**
 * Return a health snapshot spanning totals, orphans, staleness signals,
 * batch state, and the most recent audit timestamp. Parallelizes the
 * independent reads via Promise.all.
 */
export async function getDataHealth(): Promise<DataHealth> {
  const db = getRunwayDb();

  const [
    allProjects,
    allWeekItems,
    allClientsRows,
    allUpdates,
    allPipelineItems,
  ] = await Promise.all([
    db.select().from(projects),
    db.select().from(weekItems),
    db.select().from(clients),
    db.select().from(updates),
    db.select().from(pipelineItems),
  ]);

  // Orphans — compute in a single pass per table.
  const weekItemsWithoutProject = allWeekItems.reduce(
    (n, w) => (w.projectId == null ? n + 1 : n),
    0
  );
  const projectsWithoutClient = allProjects.reduce(
    (n, p) => (p.clientId == null ? n + 1 : n),
    0
  );

  // Dangling triggeredByUpdateId — check against the set of existing update ids.
  const updateIds = new Set(allUpdates.map((u) => u.id));
  const updatesWithDanglingTriggeredBy = allUpdates.reduce((n, u) => {
    if (u.triggeredByUpdateId && !updateIds.has(u.triggeredByUpdateId)) return n + 1;
    return n;
  }, 0);

  // Stale signals. Computed from `updatedAt` rather than `projects.stale_days`
  // which has no writer since v3 (always null in practice).
  const nowMs = Date.now();
  const staleProjectsCount = allProjects.reduce((n, p) => {
    if (p.status && STALE_EXCLUDED_STATUSES.has(p.status)) return n;
    if (!p.updatedAt) return n;
    const days = Math.floor((nowMs - p.updatedAt.getTime()) / (24 * 60 * 60 * 1000));
    return days >= 14 ? n + 1 : n;
  }, 0);

  const today = todayISODate();
  const pastEndL2sCount = allWeekItems.reduce((n, w) => {
    if (w.status !== "in-progress") return n;
    const end = w.endDate ?? w.startDate ?? null;
    if (!end) return n;
    return end < today ? n + 1 : n;
  }, 0);

  // Batch state.
  const activeBatchId = getBatchId();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentBatchIds = new Set<string>();
  let lastUpdateAt: Date | null = null;
  for (const u of allUpdates) {
    if (u.createdAt && (!lastUpdateAt || u.createdAt > lastUpdateAt)) {
      lastUpdateAt = u.createdAt;
    }
    if (u.batchId && u.createdAt && u.createdAt >= sevenDaysAgo) {
      recentBatchIds.add(u.batchId);
    }
  }

  return {
    totals: {
      projects: allProjects.length,
      weekItems: allWeekItems.length,
      clients: allClientsRows.length,
      updates: allUpdates.length,
      pipelineItems: allPipelineItems.length,
    },
    orphans: {
      weekItemsWithoutProject,
      projectsWithoutClient,
      updatesWithDanglingTriggeredBy,
    },
    stale: {
      staleProjects: staleProjectsCount,
      pastEndL2s: pastEndL2sCount,
    },
    batch: {
      activeBatchId,
      distinctBatchIdsLast7Days: recentBatchIds.size,
    },
    lastUpdateAt,
  };
}

// ── getRowsChangedSince ─────────────────────────────────

/** Tables `getRowsChangedSince` can inspect. */
export type ChangedSinceTable =
  | "projects"
  | "weekItems"
  | "clients"
  | "pipelineItems";

const ALL_CHANGED_SINCE_TABLES: readonly ChangedSinceTable[] = [
  "projects",
  "weekItems",
  "clients",
  "pipelineItems",
];

export interface GetRowsChangedSinceOptions {
  /** Limit to this subset of tables. Defaults to all four. */
  tables?: ChangedSinceTable[];
  /** When set, narrow results to rows belonging to the given client slug. */
  clientSlug?: string;
}

export interface GetRowsChangedSinceResult {
  /** Echo of the parsed-then-ISO `since` value used for the `>=` comparison. */
  since: string;
  counts: {
    projects: number;
    weekItems: number;
    clients: number;
    pipelineItems: number;
  };
  projects: ProjectRow[];
  weekItems: WeekItemRow[];
  clients: ClientRow[];
  pipelineItems: PipelineItemRow[];
}

/**
 * Return rows in projects / week_items / clients / pipeline_items whose
 * `updated_at` is `>= since` (inclusive). Use this to answer questions like
 * "what changed since <timestamp>?" — e.g. after a cleanup batch, or when a
 * caller has stored state and wants the drift since a known point.
 *
 * Options:
 *  - `tables` — subset of tables to query. Default: all four. Tables not in
 *    the filter return `[]` with `0` in `counts` and no query is issued.
 *  - `clientSlug` — narrow to one client. For projects/weekItems/pipelineItems
 *    this filters by `client_id`; for the `clients` table it filters by
 *    `slug`. Unknown slug returns empty results across every included table.
 *
 * Throws a clear error when `since` can't be parsed into a Date.
 */
export async function getRowsChangedSince(
  since: string,
  opts: GetRowsChangedSinceOptions = {},
): Promise<GetRowsChangedSinceResult> {
  const parsed = new Date(since);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `getRowsChangedSince: invalid 'since' value ${JSON.stringify(since)} — expected an ISO timestamp.`,
    );
  }

  const tableSet = new Set<ChangedSinceTable>(
    opts.tables && opts.tables.length > 0 ? opts.tables : ALL_CHANGED_SINCE_TABLES,
  );

  // Resolve clientSlug to a client id for projects/weekItems/pipelineItems
  // filtering. A slug that doesn't resolve should produce empty results for
  // those three tables (but still allow a `clients` slug match — handled
  // below).
  let clientId: string | null = null;
  if (opts.clientSlug) {
    const client = await getClientBySlug(opts.clientSlug);
    clientId = client?.id ?? null;
  }

  const db = getRunwayDb();

  const projectsPromise: Promise<ProjectRow[]> = tableSet.has("projects")
    ? (async () => {
        if (opts.clientSlug && !clientId) return [];
        const rows = await db
          .select()
          .from(projects)
          .where(gte(projects.updatedAt, parsed));
        return clientId ? rows.filter((r) => r.clientId === clientId) : rows;
      })()
    : Promise.resolve([]);

  const weekItemsPromise: Promise<WeekItemRow[]> = tableSet.has("weekItems")
    ? (async () => {
        if (opts.clientSlug && !clientId) return [];
        const rows = await db
          .select()
          .from(weekItems)
          .where(gte(weekItems.updatedAt, parsed));
        return clientId ? rows.filter((r) => r.clientId === clientId) : rows;
      })()
    : Promise.resolve([]);

  const pipelineItemsPromise: Promise<PipelineItemRow[]> = tableSet.has("pipelineItems")
    ? (async () => {
        if (opts.clientSlug && !clientId) return [];
        const rows = await db
          .select()
          .from(pipelineItems)
          .where(gte(pipelineItems.updatedAt, parsed));
        return clientId ? rows.filter((r) => r.clientId === clientId) : rows;
      })()
    : Promise.resolve([]);

  const clientsPromise: Promise<ClientRow[]> = tableSet.has("clients")
    ? (async () => {
        const rows = await db
          .select()
          .from(clients)
          .where(gte(clients.updatedAt, parsed));
        return opts.clientSlug
          ? rows.filter((r) => r.slug === opts.clientSlug)
          : rows;
      })()
    : Promise.resolve([]);

  const [projectsRows, weekItemsRows, pipelineItemsRows, clientsRows] =
    await Promise.all([
      projectsPromise,
      weekItemsPromise,
      pipelineItemsPromise,
      clientsPromise,
    ]);

  return {
    since: parsed.toISOString(),
    counts: {
      projects: projectsRows.length,
      weekItems: weekItemsRows.length,
      clients: clientsRows.length,
      pipelineItems: pipelineItemsRows.length,
    },
    projects: projectsRows,
    weekItems: weekItemsRows,
    clients: clientsRows,
    pipelineItems: pipelineItemsRows,
  };
}
