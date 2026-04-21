/**
 * Integration tests for operations-reads-health.ts
 *
 * Uses real SQLite via test-db.ts helper — no mocks except the DB module
 * injection. Follows the same pattern as operations-reads-clients.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "./test-db";
import { invalidateClientCache, setBatchId } from "./operations-utils";

let testDb: TestDb;
let libsqlClient: Client;
let dbPath: string;

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

// Helper — epoch seconds for update rows' created_at column.
const nowSeconds = () => Math.floor(Date.now() / 1000);

async function insertUpdate(opts: {
  id: string;
  idempotencyKey?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  updatedBy?: string | null;
  updateType?: string | null;
  summary?: string | null;
  batchId?: string | null;
  triggeredByUpdateId?: string | null;
  createdAtSeconds?: number;
}): Promise<void> {
  await libsqlClient.execute({
    sql: `INSERT INTO updates (id, idempotency_key, project_id, client_id, updated_by, update_type, previous_value, new_value, summary, metadata, batch_id, triggered_by_update_id, slack_message_ts, created_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, NULL, ?)`,
    args: [
      opts.id,
      opts.idempotencyKey ?? opts.id,
      opts.projectId ?? null,
      opts.clientId ?? null,
      opts.updatedBy ?? "tester",
      opts.updateType ?? "note",
      opts.summary ?? null,
      opts.batchId ?? null,
      opts.triggeredByUpdateId ?? null,
      opts.createdAtSeconds ?? nowSeconds(),
    ],
  });
}

beforeEach(async () => {
  const created = await createTestDb();
  testDb = created.db;
  libsqlClient = created.client;
  dbPath = created.dbPath;
  await seedTestDb(libsqlClient);
  invalidateClientCache();
  setBatchId(null); // reset between tests
});

afterEach(() => {
  cleanupTestDb(dbPath);
  setBatchId(null);
});

describe("getDataHealth", () => {
  it("returns totals for all primary tables", async () => {
    const { getDataHealth } = await import("./operations-reads-health");
    const health = await getDataHealth();

    // Seed data: 4 clients, 7 projects, 8 week items, 3 pipeline items, 0 updates.
    expect(health.totals.clients).toBe(4);
    expect(health.totals.projects).toBe(7);
    expect(health.totals.weekItems).toBe(8);
    expect(health.totals.pipelineItems).toBe(3);
    expect(health.totals.updates).toBe(0);
  });

  it("counts week items with no projectId as orphans", async () => {
    const { getDataHealth } = await import("./operations-reads-health");

    // Add an orphan week item (no project_id).
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, title, sort_order, created_at, updated_at)
            VALUES (?, NULL, NULL, '2026-04-13', '2026-04-14', 'orphan', 99, ?, ?)`,
      args: ["wi-orphan", nowSeconds(), nowSeconds()],
    });

    const health = await getDataHealth();
    expect(health.orphans.weekItemsWithoutProject).toBe(1);
  });

  it("counts dangling triggeredByUpdateId references", async () => {
    const { getDataHealth } = await import("./operations-reads-health");

    await insertUpdate({ id: "u-parent" });
    await insertUpdate({ id: "u-child-linked", triggeredByUpdateId: "u-parent" });
    await insertUpdate({ id: "u-child-dangling", triggeredByUpdateId: "does-not-exist" });

    const health = await getDataHealth();
    expect(health.orphans.updatesWithDanglingTriggeredBy).toBe(1);
  });

  it("counts stale projects, excluding completed and on-hold", async () => {
    const { getDataHealth } = await import("./operations-reads-health");

    // Three stale projects: one active (counted), one completed (excluded), one on-hold (excluded).
    await libsqlClient.execute({
      sql: `UPDATE projects SET stale_days = 30 WHERE id = 'pj-cds'`,
      args: [],
    });
    await libsqlClient.execute({
      sql: `UPDATE projects SET stale_days = 30, status = 'completed' WHERE id = 'pj-impact'`,
      args: [],
    });
    await libsqlClient.execute({
      sql: `UPDATE projects SET stale_days = 30, status = 'on-hold' WHERE id = 'pj-map'`,
      args: [],
    });

    const health = await getDataHealth();
    expect(health.stale.staleProjects).toBe(1);
  });

  it("counts in-progress week items past their end date as pastEndL2s", async () => {
    const { getDataHealth } = await import("./operations-reads-health");

    // Set an in-progress item with end date in the past.
    await libsqlClient.execute({
      sql: `UPDATE week_items SET status = 'in-progress', end_date = '2000-01-01' WHERE id = 'wi-cds-review'`,
      args: [],
    });
    // And one in-progress with end_date in the future — should not count.
    await libsqlClient.execute({
      sql: `UPDATE week_items SET status = 'in-progress', end_date = '2099-12-31' WHERE id = 'wi-impact-dl'`,
      args: [],
    });

    const health = await getDataHealth();
    expect(health.stale.pastEndL2s).toBe(1);
  });

  it("reports active batch id from in-memory setBatchId", async () => {
    const { getDataHealth } = await import("./operations-reads-health");

    setBatchId("batch-xyz");
    const health = await getDataHealth();
    expect(health.batch.activeBatchId).toBe("batch-xyz");
  });

  it("returns null activeBatchId when no batch is set", async () => {
    const { getDataHealth } = await import("./operations-reads-health");

    const health = await getDataHealth();
    expect(health.batch.activeBatchId).toBe(null);
  });

  it("counts distinct batch ids from the last 7 days", async () => {
    const { getDataHealth } = await import("./operations-reads-health");

    await insertUpdate({ id: "u1", batchId: "b-A" });
    await insertUpdate({ id: "u2", batchId: "b-A" }); // duplicate — same batch
    await insertUpdate({ id: "u3", batchId: "b-B" });
    // Old batch outside the 7d window.
    const oldTime = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    await insertUpdate({ id: "u4", batchId: "b-OLD", createdAtSeconds: oldTime });

    const health = await getDataHealth();
    expect(health.batch.distinctBatchIdsLast7Days).toBe(2);
  });

  it("returns the most recent update timestamp", async () => {
    const { getDataHealth } = await import("./operations-reads-health");

    const earlier = Math.floor(Date.now() / 1000) - 3600;
    const later = Math.floor(Date.now() / 1000);
    await insertUpdate({ id: "u-earlier", createdAtSeconds: earlier });
    await insertUpdate({ id: "u-later", createdAtSeconds: later });

    const health = await getDataHealth();
    expect(health.lastUpdateAt).not.toBe(null);
    expect(health.lastUpdateAt!.getTime()).toBeGreaterThanOrEqual(later * 1000);
  });

  it("returns null lastUpdateAt when no updates exist", async () => {
    const { getDataHealth } = await import("./operations-reads-health");
    const health = await getDataHealth();
    expect(health.lastUpdateAt).toBe(null);
  });
});

describe("getCurrentBatch", () => {
  it("returns { active: false } when no batch is set", async () => {
    const { getCurrentBatch } = await import("./operations-reads-health");
    const result = await getCurrentBatch();
    expect(result).toEqual({ active: false });
  });

  it("returns batch details when a batch is active with no audit rows yet", async () => {
    const { getCurrentBatch } = await import("./operations-reads-health");
    setBatchId("batch-empty");

    const result = await getCurrentBatch();
    expect(result.active).toBe(true);
    if (!result.active) throw new Error("unreachable");
    expect(result.batchId).toBe("batch-empty");
    expect(result.itemCount).toBe(0);
    expect(result.startedAt).toBe(null);
    expect(result.startedBy).toBe(null);
    expect(result.mostRecentAt).toBe(null);
  });

  it("counts audit rows and derives startedAt/startedBy from the earliest row", async () => {
    const { getCurrentBatch } = await import("./operations-reads-health");
    setBatchId("batch-live");

    const earliest = Math.floor(Date.now() / 1000) - 3600;
    const middle = Math.floor(Date.now() / 1000) - 1800;
    const latest = Math.floor(Date.now() / 1000);

    await insertUpdate({
      id: "u-live-1",
      batchId: "batch-live",
      updatedBy: "kathy",
      createdAtSeconds: earliest,
    });
    await insertUpdate({
      id: "u-live-2",
      batchId: "batch-live",
      updatedBy: "jason",
      createdAtSeconds: middle,
    });
    await insertUpdate({
      id: "u-live-3",
      batchId: "batch-live",
      updatedBy: "lane",
      createdAtSeconds: latest,
    });
    // A row from a different batch — should be ignored.
    await insertUpdate({
      id: "u-other",
      batchId: "other-batch",
      updatedBy: "noise",
      createdAtSeconds: latest,
    });

    const result = await getCurrentBatch();
    expect(result.active).toBe(true);
    if (!result.active) throw new Error("unreachable");
    expect(result.batchId).toBe("batch-live");
    expect(result.itemCount).toBe(3);
    expect(result.startedBy).toBe("kathy");
    expect(result.startedAt!.getTime()).toBe(earliest * 1000);
    expect(result.mostRecentAt!.getTime()).toBe(latest * 1000);
  });
});

describe("getBatchContents", () => {
  it("returns empty groups when batch id has no rows", async () => {
    const { getBatchContents } = await import("./operations-reads-health");
    const result = await getBatchContents("nonexistent");
    expect(result.batchId).toBe("nonexistent");
    expect(result.totalUpdates).toBe(0);
    expect(result.groups).toEqual([]);
  });

  it("groups rows by (client, project) with names resolved", async () => {
    const { getBatchContents } = await import("./operations-reads-health");

    await insertUpdate({
      id: "u1",
      batchId: "b-1",
      clientId: "cl-convergix",
      projectId: "pj-cds",
      updateType: "status-change",
      summary: "CDS completed",
    });
    await insertUpdate({
      id: "u2",
      batchId: "b-1",
      clientId: "cl-convergix",
      projectId: "pj-cds",
      updateType: "note",
      summary: "another cds update",
    });
    await insertUpdate({
      id: "u3",
      batchId: "b-1",
      clientId: "cl-bonterra",
      projectId: "pj-impact",
      updateType: "note",
      summary: "bonterra update",
    });
    // Different batch — must be excluded.
    await insertUpdate({
      id: "u-other",
      batchId: "b-other",
      clientId: "cl-convergix",
      projectId: "pj-cds",
      summary: "should not appear",
    });

    const result = await getBatchContents("b-1");
    expect(result.totalUpdates).toBe(3);
    expect(result.groups).toHaveLength(2);

    // Sorted alphabetically: Bonterra before Convergix.
    expect(result.groups[0].clientName).toBe("Bonterra");
    expect(result.groups[0].projectName).toBe("Impact Report");
    expect(result.groups[0].updates).toHaveLength(1);
    expect(result.groups[0].updates[0].id).toBe("u3");

    expect(result.groups[1].clientName).toBe("Convergix");
    expect(result.groups[1].projectName).toBe("CDS Messaging");
    expect(result.groups[1].updates).toHaveLength(2);
  });

  it("orders updates within a group by createdAt ascending", async () => {
    const { getBatchContents } = await import("./operations-reads-health");

    const now = Math.floor(Date.now() / 1000);
    await insertUpdate({
      id: "u-late",
      batchId: "b-ord",
      clientId: "cl-convergix",
      projectId: "pj-cds",
      createdAtSeconds: now,
    });
    await insertUpdate({
      id: "u-early",
      batchId: "b-ord",
      clientId: "cl-convergix",
      projectId: "pj-cds",
      createdAtSeconds: now - 3600,
    });

    const result = await getBatchContents("b-ord");
    expect(result.groups[0].updates[0].id).toBe("u-early");
    expect(result.groups[0].updates[1].id).toBe("u-late");
  });

  it("handles rows without client or project (null group key)", async () => {
    const { getBatchContents } = await import("./operations-reads-health");

    await insertUpdate({
      id: "u-bare",
      batchId: "b-bare",
      // no clientId, no projectId
      updateType: "system",
      summary: "system-level note",
    });

    const result = await getBatchContents("b-bare");
    expect(result.totalUpdates).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].clientName).toBe(null);
    expect(result.groups[0].projectName).toBe(null);
    expect(result.groups[0].updates[0].id).toBe("u-bare");
  });
});

describe("getCascadeLog", () => {
  it("defaults the window to 60 minutes", async () => {
    const { getCascadeLog } = await import("./operations-reads-health");
    const result = await getCascadeLog();
    expect(result.windowMinutes).toBe(60);
    // `since` should be ~60min before now; allow generous slack.
    const delta = Date.now() - result.since.getTime();
    expect(delta).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5_000);
    expect(delta).toBeLessThanOrEqual(60 * 60 * 1000 + 5_000);
  });

  it("uses the default window when called with undefined", async () => {
    const { getCascadeLog } = await import("./operations-reads-health");
    const result = await getCascadeLog(undefined);
    expect(result.windowMinutes).toBe(60);
  });

  it("filters to updateTypes starting with cascade-", async () => {
    const { getCascadeLog } = await import("./operations-reads-health");

    await insertUpdate({
      id: "u-parent",
      clientId: "cl-convergix",
      projectId: "pj-cds",
      updateType: "status-change",
      summary: "CDS: active -> completed",
    });
    await insertUpdate({
      id: "u-cascade-status",
      clientId: "cl-convergix",
      projectId: "pj-cds",
      updateType: "cascade-status",
      summary: "cascaded status",
      triggeredByUpdateId: "u-parent",
    });
    await insertUpdate({
      id: "u-cascade-duedate",
      clientId: "cl-convergix",
      projectId: "pj-cds",
      updateType: "cascade-duedate",
      summary: "cascaded due date",
      triggeredByUpdateId: "u-parent",
    });
    await insertUpdate({
      id: "u-note",
      clientId: "cl-convergix",
      projectId: "pj-cds",
      updateType: "note",
      summary: "not a cascade",
    });

    const result = await getCascadeLog(60);
    expect(result.totalCascadeRows).toBe(2);
    expect(result.groups).toHaveLength(1);
    const group = result.groups[0];
    expect(group.parentUpdateId).toBe("u-parent");
    expect(group.parent?.id).toBe("u-parent");
    expect(group.parent?.updateType).toBe("status-change");
    expect(group.parent?.clientName).toBe("Convergix");
    expect(group.children).toHaveLength(2);
    const childTypes = group.children.map((c) => c.updateType).sort();
    expect(childTypes).toEqual(["cascade-duedate", "cascade-status"]);
  });

  it("excludes cascade rows outside the window", async () => {
    const { getCascadeLog } = await import("./operations-reads-health");

    const recentSeconds = Math.floor(Date.now() / 1000);
    const oldSeconds = recentSeconds - 2 * 60 * 60; // 2 hours ago

    await insertUpdate({
      id: "u-parent-old",
      updateType: "status-change",
      summary: "old parent",
      createdAtSeconds: oldSeconds,
    });
    await insertUpdate({
      id: "u-cascade-old",
      updateType: "cascade-status",
      summary: "old cascade",
      triggeredByUpdateId: "u-parent-old",
      createdAtSeconds: oldSeconds,
    });
    await insertUpdate({
      id: "u-parent-new",
      updateType: "status-change",
      summary: "new parent",
      createdAtSeconds: recentSeconds,
    });
    await insertUpdate({
      id: "u-cascade-new",
      updateType: "cascade-status",
      summary: "new cascade",
      triggeredByUpdateId: "u-parent-new",
      createdAtSeconds: recentSeconds,
    });

    const result = await getCascadeLog(60);
    expect(result.totalCascadeRows).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].parentUpdateId).toBe("u-parent-new");
  });

  it("groups cascade children under their shared parent", async () => {
    const { getCascadeLog } = await import("./operations-reads-health");

    await insertUpdate({ id: "parent-A", updateType: "status-change" });
    await insertUpdate({ id: "parent-B", updateType: "status-change" });
    await insertUpdate({
      id: "child-A1",
      updateType: "cascade-status",
      triggeredByUpdateId: "parent-A",
    });
    await insertUpdate({
      id: "child-A2",
      updateType: "cascade-duedate",
      triggeredByUpdateId: "parent-A",
    });
    await insertUpdate({
      id: "child-B1",
      updateType: "cascade-status",
      triggeredByUpdateId: "parent-B",
    });

    const result = await getCascadeLog(60);
    expect(result.totalCascadeRows).toBe(3);
    expect(result.groups).toHaveLength(2);
    const groupA = result.groups.find((g) => g.parentUpdateId === "parent-A");
    const groupB = result.groups.find((g) => g.parentUpdateId === "parent-B");
    expect(groupA?.children).toHaveLength(2);
    expect(groupB?.children).toHaveLength(1);
  });

  it("handles cascade rows with null triggeredByUpdateId", async () => {
    const { getCascadeLog } = await import("./operations-reads-health");

    await insertUpdate({
      id: "c-orphan",
      updateType: "cascade-status",
      summary: "orphan cascade",
      triggeredByUpdateId: null,
    });

    const result = await getCascadeLog(60);
    expect(result.totalCascadeRows).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].parentUpdateId).toBe(null);
    expect(result.groups[0].parent).toBe(null);
    expect(result.groups[0].children[0].id).toBe("c-orphan");
  });

  it("sets parent=null when the triggeredByUpdateId points to a missing row", async () => {
    const { getCascadeLog } = await import("./operations-reads-health");

    await insertUpdate({
      id: "c-dangling",
      updateType: "cascade-status",
      triggeredByUpdateId: "no-such-parent",
    });

    const result = await getCascadeLog(60);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].parentUpdateId).toBe("no-such-parent");
    expect(result.groups[0].parent).toBe(null);
  });

  it("returns empty groups when no cascade rows exist", async () => {
    const { getCascadeLog } = await import("./operations-reads-health");
    const result = await getCascadeLog(60);
    expect(result.totalCascadeRows).toBe(0);
    expect(result.groups).toEqual([]);
  });
});

describe("getRowsChangedSince", () => {
  /**
   * Helper: bump a row's updated_at to the given epoch seconds. Seed data
   * uses NOW_EPOCH for every row's updated_at, so these helpers let tests
   * pin specific rows to "before" or "after" the `since` cutoff.
   */
  async function setProjectUpdatedAt(id: string, epochSeconds: number): Promise<void> {
    await libsqlClient.execute({
      sql: `UPDATE projects SET updated_at = ? WHERE id = ?`,
      args: [epochSeconds, id],
    });
  }
  async function setWeekItemUpdatedAt(id: string, epochSeconds: number): Promise<void> {
    await libsqlClient.execute({
      sql: `UPDATE week_items SET updated_at = ? WHERE id = ?`,
      args: [epochSeconds, id],
    });
  }
  async function setClientUpdatedAt(id: string, epochSeconds: number): Promise<void> {
    await libsqlClient.execute({
      sql: `UPDATE clients SET updated_at = ? WHERE id = ?`,
      args: [epochSeconds, id],
    });
  }
  async function setPipelineItemUpdatedAt(id: string, epochSeconds: number): Promise<void> {
    await libsqlClient.execute({
      sql: `UPDATE pipeline_items SET updated_at = ? WHERE id = ?`,
      args: [epochSeconds, id],
    });
  }

  it("returns zero counts + empty arrays when no rows changed after `since`", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");

    // Push every row to epoch 1000 (~ 1970) so nothing is >= a recent `since`.
    await libsqlClient.execute({ sql: `UPDATE projects SET updated_at = 1000`, args: [] });
    await libsqlClient.execute({ sql: `UPDATE week_items SET updated_at = 1000`, args: [] });
    await libsqlClient.execute({ sql: `UPDATE clients SET updated_at = 1000`, args: [] });
    await libsqlClient.execute({ sql: `UPDATE pipeline_items SET updated_at = 1000`, args: [] });
    invalidateClientCache();

    const result = await getRowsChangedSince(new Date().toISOString());
    expect(result.counts).toEqual({
      projects: 0,
      weekItems: 0,
      clients: 0,
      pipelineItems: 0,
    });
    expect(result.projects).toEqual([]);
    expect(result.weekItems).toEqual([]);
    expect(result.clients).toEqual([]);
    expect(result.pipelineItems).toEqual([]);
  });

  it("returns only rows with updated_at >= since across all four tables", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");

    const oldSeconds = 1000;
    const newSeconds = nowSeconds();
    const cutoff = new Date((oldSeconds + newSeconds) / 2 * 1000).toISOString();

    // Push every row old first.
    await libsqlClient.execute({ sql: `UPDATE projects SET updated_at = ?`, args: [oldSeconds] });
    await libsqlClient.execute({ sql: `UPDATE week_items SET updated_at = ?`, args: [oldSeconds] });
    await libsqlClient.execute({ sql: `UPDATE clients SET updated_at = ?`, args: [oldSeconds] });
    await libsqlClient.execute({ sql: `UPDATE pipeline_items SET updated_at = ?`, args: [oldSeconds] });
    invalidateClientCache();

    // Mark one row in each table as recently changed.
    await setProjectUpdatedAt("pj-cds", newSeconds);
    await setWeekItemUpdatedAt("wi-cds-review", newSeconds);
    await setClientUpdatedAt("cl-convergix", newSeconds);
    await setPipelineItemUpdatedAt("pl-cgx-sow", newSeconds);
    invalidateClientCache();

    const result = await getRowsChangedSince(cutoff);
    expect(result.counts).toEqual({
      projects: 1,
      weekItems: 1,
      clients: 1,
      pipelineItems: 1,
    });
    expect(result.projects[0].id).toBe("pj-cds");
    expect(result.weekItems[0].id).toBe("wi-cds-review");
    expect(result.clients[0].id).toBe("cl-convergix");
    expect(result.pipelineItems[0].id).toBe("pl-cgx-sow");
  });

  it("returns full raw columns on each row (not a projection)", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");

    const sinceIso = new Date(0).toISOString();
    const result = await getRowsChangedSince(sinceIso);

    // Seed has >=1 row per table at NOW_EPOCH >= 1970. Spot-check a project
    // carries v4-enriched fields.
    const cdsProject = result.projects.find((p) => p.id === "pj-cds");
    expect(cdsProject).toBeDefined();
    expect(cdsProject!.clientId).toBe("cl-convergix");
    expect(cdsProject!.name).toBe("CDS Messaging");
    // endDate / contractEnd / engagementType columns exist on the row shape
    // (null in seed is fine — presence matters).
    expect(cdsProject).toHaveProperty("endDate");
    expect(cdsProject).toHaveProperty("contractEnd");
    expect(cdsProject).toHaveProperty("engagementType");
  });

  it("echoes the parsed ISO `since` in the result", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");

    const iso = "2026-04-20T12:34:56.000Z";
    const result = await getRowsChangedSince(iso);
    // Parsing via Date and re-stringifying normalizes to the same ISO.
    expect(result.since).toBe(new Date(iso).toISOString());
  });

  it("throws with a clear error when `since` can't be parsed", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");
    await expect(getRowsChangedSince("not-a-real-date")).rejects.toThrow(/invalid 'since'/);
  });

  it("tables filter restricts to the named tables — others return [] and 0", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");

    const sinceIso = new Date(0).toISOString();
    const result = await getRowsChangedSince(sinceIso, { tables: ["projects"] });

    expect(result.counts.projects).toBeGreaterThan(0);
    expect(result.counts.weekItems).toBe(0);
    expect(result.counts.clients).toBe(0);
    expect(result.counts.pipelineItems).toBe(0);
    expect(result.weekItems).toEqual([]);
    expect(result.clients).toEqual([]);
    expect(result.pipelineItems).toEqual([]);
  });

  it("tables filter accepts multiple tables", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");

    const sinceIso = new Date(0).toISOString();
    const result = await getRowsChangedSince(sinceIso, {
      tables: ["projects", "clients"],
    });

    expect(result.counts.projects).toBeGreaterThan(0);
    expect(result.counts.clients).toBeGreaterThan(0);
    expect(result.counts.weekItems).toBe(0);
    expect(result.counts.pipelineItems).toBe(0);
  });

  it("clientSlug narrows projects/weekItems/pipelineItems by client_id", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");

    const sinceIso = new Date(0).toISOString();
    const result = await getRowsChangedSince(sinceIso, { clientSlug: "convergix" });

    // Every project/weekItem/pipelineItem returned must belong to Convergix.
    for (const p of result.projects) expect(p.clientId).toBe("cl-convergix");
    for (const w of result.weekItems) expect(w.clientId).toBe("cl-convergix");
    for (const pl of result.pipelineItems) expect(pl.clientId).toBe("cl-convergix");

    // Convergix has >=1 project and >=1 week item in the seed.
    expect(result.counts.projects).toBeGreaterThan(0);
    expect(result.counts.weekItems).toBeGreaterThan(0);
  });

  it("clientSlug narrows the `clients` table by slug", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");

    const sinceIso = new Date(0).toISOString();
    const result = await getRowsChangedSince(sinceIso, { clientSlug: "convergix" });

    expect(result.counts.clients).toBe(1);
    expect(result.clients[0].slug).toBe("convergix");
  });

  it("clientSlug that doesn't resolve returns empty results across every table", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");

    const sinceIso = new Date(0).toISOString();
    const result = await getRowsChangedSince(sinceIso, { clientSlug: "no-such-client" });

    expect(result.counts).toEqual({
      projects: 0,
      weekItems: 0,
      clients: 0,
      pipelineItems: 0,
    });
  });

  it("uses inclusive `>=` comparison (a row exactly at `since` is included)", async () => {
    const { getRowsChangedSince } = await import("./operations-reads-health");

    const cutoffSeconds = nowSeconds();
    const cutoffIso = new Date(cutoffSeconds * 1000).toISOString();

    // Push everything to 1 second before the cutoff, then bump one project
    // to exactly the cutoff — it must appear in the result.
    await libsqlClient.execute({ sql: `UPDATE projects SET updated_at = ?`, args: [cutoffSeconds - 1] });
    await setProjectUpdatedAt("pj-cds", cutoffSeconds);

    const result = await getRowsChangedSince(cutoffIso, { tables: ["projects"] });
    expect(result.projects.map((p) => p.id)).toContain("pj-cds");
  });
});
