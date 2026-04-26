/**
 * Integration tests for parentProjectId validators + contract-date invariant
 * + updateProjectField wiring.
 *
 * Uses test-db.ts (in-memory SQLite) to exercise real DB behavior — no mocks.
 * Covers:
 *  - validateParentProjectIdAssignment (4 invariants)
 *  - updateProjectField parentProjectId branch reuses the shared validator
 *  - Helper-level contract-date invariant on contractStart / contractEnd
 *    single-field updates
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  libsqlClient.close();
  cleanupTestDb(dbPath);
});

// ── Helpers ─────────────────────────────────────────────

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

async function setContractDates(
  id: string,
  start: string | null,
  end: string | null,
): Promise<void> {
  await libsqlClient.execute({
    sql: `UPDATE projects SET contract_start = ?, contract_end = ? WHERE id = ?`,
    args: [start, end, id],
  });
}

// ── validateParentProjectIdAssignment ─────────────────────

describe("validateParentProjectIdAssignment", () => {
  it("accepts null newParentId (clears the link)", async () => {
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-cds",
      childClientId: "cl-convergix",
      newParentId: null,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects when parent does not exist", async () => {
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-cds",
      childClientId: "cl-convergix",
      newParentId: "pj-does-not-exist",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/);
  });

  it("rejects non-retainer parent", async () => {
    // pj-social-cgx has engagement_type = NULL by default.
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-cds",
      childClientId: "cl-convergix",
      newParentId: "pj-social-cgx",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/must be 'retainer'/);
  });

  it("rejects cross-client parent", async () => {
    // pj-impact is on Bonterra; child is on Convergix.
    await setEngagementType("pj-impact", "retainer");
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-cds",
      childClientId: "cl-convergix",
      newParentId: "pj-impact",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cross-client parenting forbidden/);
  });

  it("rejects a direct cycle (parent's parent points at child)", async () => {
    // pj-social-cgx is parented under pj-cds; now try to make pj-cds's
    // parent be pj-social-cgx — that would form pj-cds → pj-social-cgx → pj-cds.
    await setEngagementType("pj-cds", "retainer");
    await setEngagementType("pj-social-cgx", "retainer");
    await setParent("pj-social-cgx", "pj-cds");

    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-cds",
      childClientId: "cl-convergix",
      newParentId: "pj-social-cgx",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Cycle detected/);
  });

  it("accepts a valid retainer-wrapper assignment", async () => {
    await setEngagementType("pj-cds", "retainer");
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-social-cgx",
      childClientId: "cl-convergix",
      newParentId: "pj-cds",
    });
    expect(result).toEqual({ ok: true });
  });
});

// ── updateProjectField parentProjectId branch reuses validator ──

describe("updateProjectField parentProjectId — shared validator wiring", () => {
  it("rejects non-existent parent through update_project_field path", async () => {
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "Social Content",
      field: "parentProjectId",
      newValue: "pj-does-not-exist",
      updatedBy: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/);
  });

  it("rejects non-retainer parent through update_project_field path", async () => {
    const { updateProjectField } = await import("./operations-writes-project");
    // pj-cds has engagement_type=NULL. Try parenting pj-social-cgx under it.
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "Social Content",
      field: "parentProjectId",
      newValue: "pj-cds",
      updatedBy: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/must be 'retainer'/);
  });

  it("rejects cross-client parent through update_project_field path", async () => {
    await setEngagementType("pj-impact", "retainer");
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "Social Content",
      field: "parentProjectId",
      newValue: "pj-impact",
      updatedBy: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cross-client parenting forbidden/);
  });

  it("rejects cycle through update_project_field path", async () => {
    await setEngagementType("pj-cds", "retainer");
    await setEngagementType("pj-social-cgx", "retainer");
    await setParent("pj-social-cgx", "pj-cds");
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "parentProjectId",
      newValue: "pj-social-cgx",
      updatedBy: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Cycle detected/);
  });

  it("accepts a valid wrapper assignment and persists parent_project_id", async () => {
    await setEngagementType("pj-cds", "retainer");
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "Social Content",
      field: "parentProjectId",
      newValue: "pj-cds",
      updatedBy: "test",
    });
    expect(result.ok).toBe(true);
    const child = await getProject(testDb, "pj-social-cgx");
    expect(child?.parentProjectId).toBe("pj-cds");
  });

  it("accepts empty-string newValue (clears parent_project_id)", async () => {
    await setEngagementType("pj-cds", "retainer");
    await setParent("pj-social-cgx", "pj-cds");
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "Social Content",
      field: "parentProjectId",
      newValue: "",
      updatedBy: "test",
    });
    expect(result.ok).toBe(true);
    const child = await getProject(testDb, "pj-social-cgx");
    expect(child?.parentProjectId).toBeNull();
  });
});

// ── Contract-date invariant (helper-level) ────────────────

describe("updateProjectField contract-date invariant", () => {
  it("rejects contractEnd that is not strictly after current contractStart", async () => {
    await setContractDates("pj-cds", "2026-02-01", null);
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "contractEnd",
      newValue: "2026-01-15",
      updatedBy: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/contractEnd .* must be > contractStart/);
  });

  it("rejects contractStart that is not strictly before current contractEnd", async () => {
    await setContractDates("pj-cds", null, "2026-06-01");
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "contractStart",
      newValue: "2026-07-01",
      updatedBy: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/contractStart .* must be < contractEnd/);
  });

  it("accepts contractEnd update when current contractStart is null", async () => {
    await setContractDates("pj-cds", null, null);
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "contractEnd",
      newValue: "2026-12-31",
      updatedBy: "test",
    });
    expect(result.ok).toBe(true);
    const row = await getProject(testDb, "pj-cds");
    expect(row?.contractEnd).toBe("2026-12-31");
  });

  it("accepts contractStart update when current contractEnd is null", async () => {
    await setContractDates("pj-cds", null, null);
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "contractStart",
      newValue: "2026-02-01",
      updatedBy: "test",
    });
    expect(result.ok).toBe(true);
    const row = await getProject(testDb, "pj-cds");
    expect(row?.contractStart).toBe("2026-02-01");
  });

  it("accepts a valid end-after-start update and writes audit", async () => {
    await setContractDates("pj-cds", "2026-02-01", null);
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "contractEnd",
      newValue: "2026-07-31",
      updatedBy: "test",
    });
    expect(result.ok).toBe(true);
    const row = await getProject(testDb, "pj-cds");
    expect(row?.contractEnd).toBe("2026-07-31");
    const auditRows = await libsqlClient.execute({
      sql: `SELECT update_type, new_value FROM updates WHERE project_id = 'pj-cds' AND update_type = 'field-change'`,
      args: [],
    });
    expect(auditRows.rows.length).toBeGreaterThan(0);
  });

  it("allows clearing contractEnd via empty string regardless of contractStart", async () => {
    await setContractDates("pj-cds", "2026-02-01", "2026-07-31");
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "contractEnd",
      newValue: "",
      updatedBy: "test",
    });
    expect(result.ok).toBe(true);
    const row = await getProject(testDb, "pj-cds");
    expect(row?.contractEnd).toBeNull();
  });
});
