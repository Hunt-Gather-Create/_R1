/**
 * Integration tests for recomputeProjectDates (v4 derivation rule).
 *
 * Uses real SQLite via test-db.ts — asserts that project.start_date / end_date
 * are correctly derived from children on every code path that touches dates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  getProject,
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
  cleanupTestDb(dbPath);
});

// ── Helpers ─────────────────────────────────────────────

async function insertWeekItem(
  libsql: Client,
  row: {
    id: string;
    projectId: string;
    clientId: string;
    startDate?: string | null;
    endDate?: string | null;
    date?: string | null;
    title?: string;
  }
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await libsql.execute({
    sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, end_date, title, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.projectId,
      row.clientId,
      row.startDate ?? row.date ?? null,
      row.date ?? null,
      row.startDate ?? null,
      row.endDate ?? null,
      row.title ?? `item-${row.id}`,
      0,
      now,
      now,
    ],
  });
}

describe("recomputeProjectDates — v4 derivation rule", () => {
  it("sets both dates null when project has no children", async () => {
    const { recomputeProjectDates } = await import("./operations-writes-week");

    // Delete any seeded children for pj-social-cgx first
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-social-cgx'");

    const result = await recomputeProjectDates("pj-social-cgx");

    expect(result).toEqual({ startDate: null, endDate: null });
    const project = await getProject(testDb, "pj-social-cgx");
    expect(project?.startDate).toBeNull();
    expect(project?.endDate).toBeNull();
  });

  it("uses child start when endDate is null (single-day)", async () => {
    // Seeded pj-cds has 4 children. Replace them with a single single-day child.
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    await insertWeekItem(libsqlClient, {
      id: "wi-solo",
      projectId: "pj-cds",
      clientId: "cl-convergix",
      startDate: "2026-05-01",
      endDate: null,
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    const result = await recomputeProjectDates("pj-cds");

    expect(result).toEqual({ startDate: "2026-05-01", endDate: "2026-05-01" });
    const project = await getProject(testDb, "pj-cds");
    expect(project?.startDate).toBe("2026-05-01");
    expect(project?.endDate).toBe("2026-05-01");
  });

  it("computes MIN(start) and MAX(end) across staggered children", async () => {
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    // 3 items: one single-day early, one multi-day mid, one single-day late.
    await insertWeekItem(libsqlClient, {
      id: "wi-early", projectId: "pj-cds", clientId: "cl-convergix",
      startDate: "2026-05-01", endDate: null,
    });
    await insertWeekItem(libsqlClient, {
      id: "wi-mid", projectId: "pj-cds", clientId: "cl-convergix",
      startDate: "2026-05-10", endDate: "2026-05-20",
    });
    await insertWeekItem(libsqlClient, {
      id: "wi-late", projectId: "pj-cds", clientId: "cl-convergix",
      startDate: "2026-05-15", endDate: null,
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    const result = await recomputeProjectDates("pj-cds");

    // Earliest start is 2026-05-01; latest end is 2026-05-20 (from the mid multi-day item).
    expect(result).toEqual({ startDate: "2026-05-01", endDate: "2026-05-20" });
  });

  it("falls back to legacy `date` column when start_date is null (pre-backfill rows)", async () => {
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    // Simulate a pre-backfill row: only `date` set, start_date is NULL.
    await insertWeekItem(libsqlClient, {
      id: "wi-legacy", projectId: "pj-cds", clientId: "cl-convergix",
      date: "2026-06-15",
      startDate: null,
      endDate: null,
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    const result = await recomputeProjectDates("pj-cds");

    expect(result).toEqual({ startDate: "2026-06-15", endDate: "2026-06-15" });
  });

  it("returns null when projectId is null/undefined (does not query db)", async () => {
    const { recomputeProjectDates } = await import("./operations-writes-week");
    expect(await recomputeProjectDates(null)).toBeNull();
    expect(await recomputeProjectDates(undefined)).toBeNull();
    expect(await recomputeProjectDates("")).toBeNull();
  });

  it("resets project dates to null when all children are deleted", async () => {
    // Seed the project with dates derived from children, then wipe children.
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-impact'");
    await insertWeekItem(libsqlClient, {
      id: "wi-tmp", projectId: "pj-impact", clientId: "cl-bonterra",
      startDate: "2026-05-01", endDate: "2026-05-10",
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    await recomputeProjectDates("pj-impact");
    let project = await getProject(testDb, "pj-impact");
    expect(project?.startDate).toBe("2026-05-01");

    // Delete all children and recompute.
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-impact'");
    const result = await recomputeProjectDates("pj-impact");

    expect(result).toEqual({ startDate: null, endDate: null });
    project = await getProject(testDb, "pj-impact");
    expect(project?.startDate).toBeNull();
    expect(project?.endDate).toBeNull();
  });

  it("ignores the contract_* override columns (they are read-layer only)", async () => {
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    // Set contract dates on project that differ from derived.
    await libsqlClient.execute({
      sql: `UPDATE projects SET contract_start = ?, contract_end = ? WHERE id = 'pj-cds'`,
      args: ["2020-01-01", "2030-12-31"],
    });
    await insertWeekItem(libsqlClient, {
      id: "wi-one", projectId: "pj-cds", clientId: "cl-convergix",
      startDate: "2026-07-01", endDate: "2026-07-10",
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    const result = await recomputeProjectDates("pj-cds");

    // Derivation uses only children — contract_* untouched.
    expect(result).toEqual({ startDate: "2026-07-01", endDate: "2026-07-10" });
    const project = await getProject(testDb, "pj-cds");
    expect(project?.contractStart).toBe("2020-01-01");
    expect(project?.contractEnd).toBe("2030-12-31");
  });

  it("skips the updated_at bump when derived dates are unchanged", async () => {
    // Debt §8: recomputeProjectDates should no-op when the derivation matches
    // the row's current state. Asserts via updated_at timestamp equality
    // before/after a second recompute call.
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    await insertWeekItem(libsqlClient, {
      id: "wi-stable", projectId: "pj-cds", clientId: "cl-convergix",
      startDate: "2026-06-01", endDate: "2026-06-10",
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    // First call — writes derived dates and bumps updated_at.
    await recomputeProjectDates("pj-cds");

    const firstRow = await libsqlClient.execute({
      sql: `SELECT updated_at FROM projects WHERE id = 'pj-cds'`,
      args: [],
    });
    const firstUpdatedAt = firstRow.rows[0].updated_at;

    // Sleep long enough that if we DID bump updated_at the new value would differ.
    await new Promise((r) => setTimeout(r, 1100));

    // Second call — same children, derived values identical → should skip.
    const result = await recomputeProjectDates("pj-cds");
    expect(result).toEqual({ startDate: "2026-06-01", endDate: "2026-06-10" });

    const secondRow = await libsqlClient.execute({
      sql: `SELECT updated_at FROM projects WHERE id = 'pj-cds'`,
      args: [],
    });
    const secondUpdatedAt = secondRow.rows[0].updated_at;
    expect(secondUpdatedAt).toBe(firstUpdatedAt);
  });

  it("does bump updated_at when derived dates actually change", async () => {
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    await insertWeekItem(libsqlClient, {
      id: "wi-initial", projectId: "pj-cds", clientId: "cl-convergix",
      startDate: "2026-06-01", endDate: "2026-06-10",
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    await recomputeProjectDates("pj-cds");

    const firstRow = await libsqlClient.execute({
      sql: `SELECT updated_at FROM projects WHERE id = 'pj-cds'`,
      args: [],
    });
    const firstUpdatedAt = firstRow.rows[0].updated_at;

    await new Promise((r) => setTimeout(r, 1100));

    // Change a child date — derived end should shift and the parent should update.
    await libsqlClient.execute({
      sql: `UPDATE week_items SET end_date = ? WHERE id = 'wi-initial'`,
      args: ["2026-06-20"],
    });
    const result = await recomputeProjectDates("pj-cds");
    expect(result).toEqual({ startDate: "2026-06-01", endDate: "2026-06-20" });

    const secondRow = await libsqlClient.execute({
      sql: `SELECT updated_at FROM projects WHERE id = 'pj-cds'`,
      args: [],
    });
    expect(secondRow.rows[0].updated_at).not.toBe(firstUpdatedAt);
  });
});
