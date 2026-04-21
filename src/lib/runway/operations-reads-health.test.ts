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
