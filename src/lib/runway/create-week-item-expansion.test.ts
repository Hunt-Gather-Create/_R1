/**
 * Integration tests for createWeekItem v4 expansion: startDate, endDate,
 * blockedBy. Verifies parent-recompute fires correctly, including under
 * the retainer-wrapper guard (commit 10).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Client } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  getProject,
  getWeekItem,
  type TestDb,
} from "./test-db";

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
});

afterEach(() => {
  libsqlClient.close();
  cleanupTestDb(dbPath);
});

async function getWeekItemByTitle(title: string) {
  const result = await libsqlClient.execute({
    sql: `SELECT * FROM week_items WHERE title = ?`,
    args: [title],
  });
  return result.rows[0] ?? null;
}

describe("createWeekItem — v4 fields", () => {
  it("persists startDate, endDate, blockedBy when provided", async () => {
    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      weekOf: "2026-05-04",
      title: "AISTech Booth Setup",
      category: "delivery",
      startDate: "2026-05-04",
      endDate: "2026-05-06",
      blockedBy: '["wi-cds-review"]',
      updatedBy: "test",
    });

    expect(result.ok).toBe(true);
    const row = await getWeekItemByTitle("AISTech Booth Setup");
    expect(row?.start_date).toBe("2026-05-04");
    expect(row?.end_date).toBe("2026-05-06");
    expect(row?.blocked_by).toBe('["wi-cds-review"]');
  });

  it("falls back to `date` when startDate is omitted", async () => {
    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      weekOf: "2026-05-04",
      date: "2026-05-05",
      title: "Single-day Item",
      updatedBy: "test",
    });

    expect(result.ok).toBe(true);
    const row = await getWeekItemByTitle("Single-day Item");
    expect(row?.start_date).toBe("2026-05-05");
    expect(row?.end_date).toBeNull();
  });

  it("triggers parent recompute when L2 has startDate (parent dates derive)", async () => {
    // pj-social-cgx starts with no L2s and null start/end_date.
    await libsqlClient.execute(`DELETE FROM week_items WHERE project_id = 'pj-social-cgx'`);
    await libsqlClient.execute(
      `UPDATE projects SET start_date = NULL, end_date = NULL WHERE id = 'pj-social-cgx'`
    );

    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "Social Content",
      weekOf: "2026-05-04",
      title: "Social Drop 1",
      startDate: "2026-05-05",
      endDate: "2026-05-08",
      updatedBy: "test",
    });

    expect(result.ok).toBe(true);
    const project = await getProject(testDb, "pj-social-cgx");
    expect(project?.startDate).toBe("2026-05-05");
    expect(project?.endDate).toBe("2026-05-08");
  });

  it("does NOT shift wrapper L1 dates when L2 lands on a retainer wrapper directly", async () => {
    // Promote pj-cds to retainer wrapper with a child L1 (pj-social-cgx).
    await libsqlClient.execute(
      `UPDATE projects SET engagement_type = 'retainer', start_date = '2026-02-01', end_date = '2026-07-31' WHERE id = 'pj-cds'`
    );
    await libsqlClient.execute(
      `UPDATE projects SET parent_project_id = 'pj-cds' WHERE id = 'pj-social-cgx'`
    );
    await libsqlClient.execute(`DELETE FROM week_items WHERE project_id = 'pj-cds'`);

    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      weekOf: "2026-09-07",
      title: "Out-of-window L2",
      startDate: "2026-09-07",
      endDate: "2026-09-09",
      updatedBy: "test",
    });

    expect(result.ok).toBe(true);
    const wrapper = await getProject(testDb, "pj-cds");
    expect(wrapper?.startDate).toBe("2026-02-01");
    expect(wrapper?.endDate).toBe("2026-07-31");
  });
});
