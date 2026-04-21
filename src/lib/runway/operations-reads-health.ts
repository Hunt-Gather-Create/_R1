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
import { getBatchId } from "./operations-utils";

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

  // Stale signals.
  const staleProjectsCount = allProjects.reduce((n, p) => {
    if (p.staleDays == null || p.staleDays < 14) return n;
    if (p.status && STALE_EXCLUDED_STATUSES.has(p.status)) return n;
    return n + 1;
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
