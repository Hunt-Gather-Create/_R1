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
  getWeekItem,
  getAuditRecords,
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

  it("normalizes resources on createWeekItem write (v4 §\"resources\")", async () => {
    // Chunk 5 debt §12.1: wire normalizeResourcesString into write paths.
    // Asserts alt arrows (`=>`, `→`) and whitespace collapse in storage.
    const { createWeekItem } = await import("./operations-writes-week");
    const result = await createWeekItem({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      date: "2026-04-22",
      title: "Chunk 5 resources normalization test",
      resources: " CD: Lane   =>Dev: Leslie, CW: Kathy",
      updatedBy: "jason",
    });
    expect(result.ok).toBe(true);
    const rows = await libsqlClient.execute({
      sql: `SELECT id, resources FROM week_items WHERE title = ?`,
      args: ["Chunk 5 resources normalization test"],
    });
    expect(rows.rows).toHaveLength(1);
    // Canonical form: `->` with single surrounding spaces, trimmed entries.
    expect(rows.rows[0].resources).toBe("CD: Lane -> Dev: Leslie, CW: Kathy");
    // Verify the helper round-trip by re-reading via drizzle:
    const item = await getWeekItem(testDb, rows.rows[0].id as string);
    expect(item?.resources).toBe("CD: Lane -> Dev: Leslie, CW: Kathy");
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

describe("recomputeProjectDates — retainer wrapper guard", () => {
  async function setEngagementType(id: string, value: string | null): Promise<void> {
    await libsqlClient.execute({
      sql: `UPDATE projects SET engagement_type = ? WHERE id = ?`,
      args: [value, id],
    });
  }

  async function setParent(childId: string, parentId: string | null): Promise<void> {
    await libsqlClient.execute({
      sql: `UPDATE projects SET parent_project_id = ? WHERE id = ?`,
      args: [parentId, childId],
    });
  }

  async function setProjectDates(
    id: string,
    startDate: string | null,
    endDate: string | null
  ): Promise<void> {
    await libsqlClient.execute({
      sql: `UPDATE projects SET start_date = ?, end_date = ? WHERE id = ?`,
      args: [startDate, endDate, id],
    });
  }

  async function clearChildren(projectId: string): Promise<void> {
    await libsqlClient.execute({
      sql: `DELETE FROM week_items WHERE project_id = ?`,
      args: [projectId],
    });
  }

  it("freezes a retainer L1 with only L2 children (L2-only wrapper) on L2 write (#8)", async () => {
    // Issue #8: pre-fix, this test asserted that an L2-only retainer fell
    // through to L2-derived recompute and overwrote stored SOW dates. The
    // guard now counts L2 children too — a retainer with any child (L1 or
    // L2) acts as a wrapper.
    await setEngagementType("pj-cds", "retainer");
    await setProjectDates("pj-cds", "2026-05-01", "2026-05-31");
    await clearChildren("pj-cds");
    await insertWeekItem(libsqlClient, {
      id: "wi-cds-only",
      projectId: "pj-cds",
      clientId: "cl-convergix",
      startDate: "2026-06-10",
      endDate: "2026-06-15",
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    const result = await recomputeProjectDates("pj-cds");

    // Stored SOW dates win over the L2 window.
    expect(result).toEqual({ startDate: "2026-05-01", endDate: "2026-05-31" });
    const row = await getProject(testDb, "pj-cds");
    expect(row?.startDate).toBe("2026-05-01");
    expect(row?.endDate).toBe("2026-05-31");
  });

  it("falls through to recompute for a truly empty retainer (no L1 + no L2 children) (#8)", async () => {
    // Issue #8: the guard wraps any retainer that has at least one child
    // (L1 or L2). A retainer with zero children of either kind falls
    // through to the shared recompute path. With no children to derive
    // from, MIN/MAX is null/null and the row gets updated accordingly.
    // This documents pre-existing recompute behavior — #8 does not change
    // it. In practice a fully-childless retainer is a migration-time edge
    // case, not a steady state.
    await setEngagementType("pj-cds", "retainer");
    await setProjectDates("pj-cds", "2026-05-01", "2026-05-31");
    await clearChildren("pj-cds");
    await libsqlClient.execute({
      sql: `UPDATE projects SET parent_project_id = NULL WHERE parent_project_id = 'pj-cds'`,
      args: [],
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    const result = await recomputeProjectDates("pj-cds");

    expect(result).toEqual({ startDate: null, endDate: null });
    const row = await getProject(testDb, "pj-cds");
    expect(row?.startDate).toBeNull();
    expect(row?.endDate).toBeNull();
  });

  it("freezes a retainer wrapper L1 (engagementType=retainer + L1 children) on direct L2 write", async () => {
    // Promote pj-cds to wrapper: retainer + at least one L1 child.
    await setEngagementType("pj-cds", "retainer");
    await setProjectDates("pj-cds", "2026-02-01", "2026-07-31");
    await setParent("pj-social-cgx", "pj-cds");
    await clearChildren("pj-cds");
    // Add a wide-ranging L2 directly on the wrapper that would normally
    // shift its dates.
    await insertWeekItem(libsqlClient, {
      id: "wi-wrapper-direct",
      projectId: "pj-cds",
      clientId: "cl-convergix",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    const result = await recomputeProjectDates("pj-cds");

    expect(result).toEqual({ startDate: "2026-02-01", endDate: "2026-07-31" });
    const row = await getProject(testDb, "pj-cds");
    expect(row?.startDate).toBe("2026-02-01");
    expect(row?.endDate).toBe("2026-07-31");
  });

  it("recomputes a child L1 normally even when it sits under a retainer wrapper", async () => {
    // pj-cds = wrapper (retainer with one child); pj-social-cgx = child L1.
    // L2 writes on the child must still recompute the child's dates; the
    // wrapper itself is untouched (no walk-up cascade by design).
    await setEngagementType("pj-cds", "retainer");
    await setProjectDates("pj-cds", "2026-02-01", "2026-07-31");
    await setParent("pj-social-cgx", "pj-cds");
    await setProjectDates("pj-social-cgx", null, null);
    await clearChildren("pj-social-cgx");
    await insertWeekItem(libsqlClient, {
      id: "wi-child-l2",
      projectId: "pj-social-cgx",
      clientId: "cl-convergix",
      startDate: "2026-04-10",
      endDate: "2026-04-12",
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    const childResult = await recomputeProjectDates("pj-social-cgx");

    expect(childResult).toEqual({ startDate: "2026-04-10", endDate: "2026-04-12" });
    const childRow = await getProject(testDb, "pj-social-cgx");
    expect(childRow?.startDate).toBe("2026-04-10");
    expect(childRow?.endDate).toBe("2026-04-12");
    // Wrapper untouched.
    const wrapperRow = await getProject(testDb, "pj-cds");
    expect(wrapperRow?.startDate).toBe("2026-02-01");
    expect(wrapperRow?.endDate).toBe("2026-07-31");
  });

  it("freezes a retainer-with-parent that has L2 children (still treated as wrapper) (#8)", async () => {
    // Issue #8: under Option B, the wrap rule is "retainer + any child (L1
    // or L2) = wrapper". Parent-link status doesn't change the wrap decision
    // (current production code at the retainer guard never read
    // parent_project_id on `project`). Pre-#8, this test asserted that a
    // retainer-with-parent fell through to L2-derived recompute; post-#8 it
    // wraps to stored dates (which are null/null here because the test
    // intentionally clears them before insert).
    await setEngagementType("pj-cds", "retainer");
    await setEngagementType("pj-social-cgx", "retainer");
    await setParent("pj-social-cgx", "pj-cds");
    await setProjectDates("pj-social-cgx", null, null);
    await clearChildren("pj-social-cgx");
    await insertWeekItem(libsqlClient, {
      id: "wi-grandchild-l2",
      projectId: "pj-social-cgx",
      clientId: "cl-convergix",
      startDate: "2026-04-15",
      endDate: "2026-04-20",
    });

    const { recomputeProjectDates } = await import("./operations-writes-week");
    const result = await recomputeProjectDates("pj-social-cgx");

    expect(result).toEqual({ startDate: null, endDate: null });
    const row = await getProject(testDb, "pj-social-cgx");
    expect(row?.startDate).toBeNull();
    expect(row?.endDate).toBeNull();
  });
});

describe("recomputeProjectDates — cascade-date-change audit row (#19)", () => {
  async function seedSingleChild(
    projectId: string,
    clientId: string,
    startDate: string,
    endDate: string | null,
  ): Promise<void> {
    await libsqlClient.execute(`DELETE FROM week_items WHERE project_id = '${projectId}'`);
    await insertWeekItem(libsqlClient, {
      id: `wi-${projectId}-seed`,
      projectId,
      clientId,
      startDate,
      endDate,
    });
  }

  it("emits a cascade-date-change row per field that moved (forward extend)", async () => {
    await seedSingleChild("pj-cds", "cl-convergix", "2026-05-01", "2026-05-10");
    const { recomputeProjectDates } = await import("./operations-writes-week");

    // Baseline recompute to set stored dates. No auditContext → no rows.
    await recomputeProjectDates("pj-cds");
    const before = await getAuditRecords(testDb, { updateType: "cascade-date-change" });
    expect(before).toHaveLength(0);

    // Forward extend: replace the child with a wider window.
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    await insertWeekItem(libsqlClient, {
      id: "wi-extended",
      projectId: "pj-cds",
      clientId: "cl-convergix",
      startDate: "2026-05-01",
      endDate: "2026-05-20",
    });

    await recomputeProjectDates("pj-cds", {
      updatedBy: "test:cascade",
      triggeredByUpdateId: "audit-trigger-1",
    });

    const after = await getAuditRecords(testDb, { updateType: "cascade-date-change" });
    expect(after).toHaveLength(1);
    expect(after[0].projectId).toBe("pj-cds");
    expect(after[0].updatedBy).toBe("test:cascade");
    expect(after[0].previousValue).toBe("2026-05-10");
    expect(after[0].newValue).toBe("2026-05-20");
    expect(after[0].triggeredByUpdateId).toBe("audit-trigger-1");
    expect(JSON.parse(after[0].metadata ?? "{}").field).toBe("endDate");
  });

  it("emits a cascade-date-change row per field that moved (backward pull on both fields)", async () => {
    await seedSingleChild("pj-cds", "cl-convergix", "2026-05-01", "2026-05-20");
    const { recomputeProjectDates } = await import("./operations-writes-week");

    // Baseline.
    await recomputeProjectDates("pj-cds");

    // Backward pull: tighter window on both ends.
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    await insertWeekItem(libsqlClient, {
      id: "wi-tighter",
      projectId: "pj-cds",
      clientId: "cl-convergix",
      startDate: "2026-05-05",
      endDate: "2026-05-15",
    });

    await recomputeProjectDates("pj-cds", {
      updatedBy: "test:cascade",
    });

    const rows = await getAuditRecords(testDb, { updateType: "cascade-date-change" });
    expect(rows).toHaveLength(2);
    const byField = Object.fromEntries(
      rows.map((r) => [JSON.parse(r.metadata ?? "{}").field, r] as const),
    );
    expect(byField.startDate.previousValue).toBe("2026-05-01");
    expect(byField.startDate.newValue).toBe("2026-05-05");
    expect(byField.endDate.previousValue).toBe("2026-05-20");
    expect(byField.endDate.newValue).toBe("2026-05-15");
  });

  it("does not emit a cascade row when recompute is a no-op", async () => {
    await seedSingleChild("pj-cds", "cl-convergix", "2026-05-01", "2026-05-10");
    const { recomputeProjectDates } = await import("./operations-writes-week");

    await recomputeProjectDates("pj-cds"); // baseline write
    const before = await getAuditRecords(testDb, { updateType: "cascade-date-change" });

    // Re-run with auditContext but no change to children.
    await recomputeProjectDates("pj-cds", { updatedBy: "test:cascade" });

    const after = await getAuditRecords(testDb, { updateType: "cascade-date-change" });
    expect(after.length).toBe(before.length);
  });

  it("does not emit a cascade row when the L2-only retainer guard short-circuits", async () => {
    // pj-cds (retainer with pinned dates) + one L2 child = L2-only retainer wrapper.
    // recompute short-circuits and returns the pinned dates — no audit row.
    await libsqlClient.execute(
      `UPDATE projects SET engagement_type = 'retainer', start_date = '2026-02-01', end_date = '2026-07-31' WHERE id = 'pj-cds'`,
    );
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    await insertWeekItem(libsqlClient, {
      id: "wi-wrapper-l2",
      projectId: "pj-cds",
      clientId: "cl-convergix",
      startDate: "2026-04-10",
      endDate: "2026-04-12",
    });
    const { recomputeProjectDates } = await import("./operations-writes-week");

    await recomputeProjectDates("pj-cds", { updatedBy: "test:cascade" });

    const rows = await getAuditRecords(testDb, { updateType: "cascade-date-change" });
    expect(rows).toHaveLength(0);

    const project = await getProject(testDb, "pj-cds");
    expect(project?.startDate).toBe("2026-02-01");
    expect(project?.endDate).toBe("2026-07-31");
  });

  it("does not emit when auditContext is omitted (backwards-compat with direct callers)", async () => {
    await seedSingleChild("pj-cds", "cl-convergix", "2026-05-01", "2026-05-20");
    const { recomputeProjectDates } = await import("./operations-writes-week");

    await recomputeProjectDates("pj-cds"); // first call, no audit context

    // Force a real recompute (date moves) without auditContext.
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    await insertWeekItem(libsqlClient, {
      id: "wi-shift",
      projectId: "pj-cds",
      clientId: "cl-convergix",
      startDate: "2026-06-01",
      endDate: "2026-06-10",
    });
    await recomputeProjectDates("pj-cds");

    const rows = await getAuditRecords(testDb, { updateType: "cascade-date-change" });
    expect(rows).toHaveLength(0);
  });

  it("no double-write: in-batch date-override on startDate suppresses the cascade row for that field but allows endDate", async () => {
    // Seed: project at (2026-05-01, 2026-05-20). Child window matches.
    await seedSingleChild("pj-cds", "cl-convergix", "2026-05-01", "2026-05-20");
    const { recomputeProjectDates } = await import("./operations-writes-week");
    await recomputeProjectDates("pj-cds");

    // Insert a date-override audit row with batchId="batch-1" pinning startDate.
    await libsqlClient.execute({
      sql: `INSERT INTO updates (id, idempotency_key, update_type, project_id, updated_by, batch_id, metadata, created_at)
            VALUES ('override-1', 'idem-1', 'date-override', 'pj-cds', 'test:cascade', 'batch-1', ?, ?)`,
      args: [JSON.stringify({ field: "startDate" }), Math.floor(Date.now() / 1000)],
    });

    // Move the child so both startDate (3->1) and endDate (20->30) would shift.
    // The startDate override should preserve project.startDate at 2026-05-01.
    await libsqlClient.execute("DELETE FROM week_items WHERE project_id = 'pj-cds'");
    await insertWeekItem(libsqlClient, {
      id: "wi-shift",
      projectId: "pj-cds",
      clientId: "cl-convergix",
      startDate: "2026-05-03",
      endDate: "2026-05-30",
    });

    // Run recompute inside the ALS batch so the override guard sees the date-override row.
    const { withBatchId } = await import("./runway-als");
    await withBatchId("batch-1", async () => {
      await recomputeProjectDates("pj-cds", { updatedBy: "test:cascade" });
    });

    const rows = await getAuditRecords(testDb, { updateType: "cascade-date-change" });
    // Only the endDate cascade row should exist; startDate was preserved by the override.
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].metadata ?? "{}").field).toBe("endDate");
    expect(rows[0].previousValue).toBe("2026-05-20");
    expect(rows[0].newValue).toBe("2026-05-30");
  });
});

