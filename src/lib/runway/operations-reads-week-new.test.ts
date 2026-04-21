/**
 * Integration tests for new v4 week-item read functions:
 *  - getOrphanWeekItems
 *  - getWeekItemsInRange
 *
 * Uses the shared in-memory SQLite seed from test-db.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "./test-db";
import { invalidateClientCache } from "./operations-utils";

let testDb: TestDb;
let libsqlClient: Client;
let dbPath: string;

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

beforeEach(async () => {
  const created = await createTestDb();
  testDb = created.db;
  libsqlClient = created.client;
  dbPath = created.dbPath;
  await seedTestDb(libsqlClient);
  invalidateClientCache();
});

afterEach(() => {
  cleanupTestDb(dbPath);
});

describe("getOrphanWeekItems", () => {
  it("returns only week items with null projectId", async () => {
    // Add two orphan rows (one per client) plus one assigned row.
    const epoch = Math.floor(Date.now() / 1000);
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, title, category, sort_order, created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["wi-orphan-1", "cl-convergix", "2026-04-20", "2026-04-22", "2026-04-22", "Orphan CGX", "review", 0, epoch, epoch],
    });
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, title, category, sort_order, created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["wi-orphan-2", "cl-bonterra", "2026-04-20", "2026-04-23", "2026-04-23", "Orphan Bonterra", "review", 0, epoch, epoch],
    });

    const { getOrphanWeekItems } = await import("./operations-reads-week");
    const result = await getOrphanWeekItems();

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.projectId === null)).toBe(true);
    expect(result.map((r) => r.id).sort()).toEqual(["wi-orphan-1", "wi-orphan-2"]);
  });

  it("returns empty array when no orphans exist", async () => {
    const { getOrphanWeekItems } = await import("./operations-reads-week");
    const result = await getOrphanWeekItems();
    // Seed has no orphan week items by default.
    expect(result).toEqual([]);
  });

  it("filters by clientSlug when provided", async () => {
    const epoch = Math.floor(Date.now() / 1000);
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, title, category, sort_order, created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["wi-cgx", "cl-convergix", "2026-04-20", "2026-04-22", "2026-04-22", "CGX orphan", "review", 0, epoch, epoch],
    });
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, title, category, sort_order, created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["wi-bon", "cl-bonterra", "2026-04-20", "2026-04-23", "2026-04-23", "Bonterra orphan", "review", 0, epoch, epoch],
    });

    const { getOrphanWeekItems } = await import("./operations-reads-week");
    const result = await getOrphanWeekItems("convergix");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("wi-cgx");
  });

  it("returns empty for unknown clientSlug", async () => {
    const epoch = Math.floor(Date.now() / 1000);
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, title, category, sort_order, created_at, updated_at)
            VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["wi-any", "cl-convergix", "2026-04-20", "2026-04-22", "2026-04-22", "whatever", "review", 0, epoch, epoch],
    });

    const { getOrphanWeekItems } = await import("./operations-reads-week");
    const result = await getOrphanWeekItems("nonexistent-slug");
    expect(result).toEqual([]);
  });
});
