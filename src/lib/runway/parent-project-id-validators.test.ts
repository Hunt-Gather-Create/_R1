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

  it("accepts a NULL-typed parent (tolerant-read default project, Delta A)", async () => {
    // pj-social-cgx has engagement_type = NULL by default. Pre-Delta-A this
    // was rejected (retainer-only parents); NULL now reads as default
    // 'project' per the tolerant-read convention.
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-cds",
      childClientId: "cl-convergix",
      newParentId: "pj-social-cgx",
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a one-off parent (childless-card contract, Delta A)", async () => {
    await setEngagementType("pj-social-cgx", "one-off");
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-cds",
      childClientId: "cl-convergix",
      newParentId: "pj-social-cgx",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/one-off/);
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
    // (No engagementType setup needed post-Delta-A: NULL parents are legal,
    // and typing the child retainer would trip L2-never-retainer before the
    // cycle walk — this test isolates the cycle rejection.)
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

// ── Delta A: parent-child engagementType combinations ─────
// Spec: runway-schema-change-plan-v4-delta-a.md §4 regression table.

describe("Delta A parent-child combinations", () => {
  it("retainer parent + project child → LEGAL (unchanged from PR #118)", async () => {
    await setEngagementType("pj-cds", "retainer");
    await setEngagementType("pj-social-cgx", "project");
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-social-cgx",
      childClientId: "cl-convergix",
      newParentId: "pj-cds",
    });
    expect(result).toEqual({ ok: true });
  });

  it("project parent + project child → LEGAL (new behavior, Delta A)", async () => {
    await setEngagementType("pj-cds", "project");
    await setEngagementType("pj-social-cgx", "project");
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-social-cgx",
      childClientId: "cl-convergix",
      newParentId: "pj-cds",
    });
    expect(result).toEqual({ ok: true });
  });

  it("retainer parent + retainer child → REJECTED (L2-never-retainer)", async () => {
    await setEngagementType("pj-cds", "retainer");
    await setEngagementType("pj-social-cgx", "retainer");
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-social-cgx",
      childClientId: "cl-convergix",
      newParentId: "pj-cds",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/L2-never-retainer/);
  });

  it("project parent + retainer child → REJECTED (L2-never-retainer)", async () => {
    await setEngagementType("pj-cds", "project");
    await setEngagementType("pj-social-cgx", "retainer");
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-social-cgx",
      childClientId: "cl-convergix",
      newParentId: "pj-cds",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/L2-never-retainer/);
  });

  it("project-under-project still capped at depth 2 (F2 composes with Delta A)", async () => {
    // pj-cds (project, top-level) ← pj-social-cgx (project, L2). A third
    // project trying to nest under the L2 must still hit the depth guard.
    // (pj-impact is seeded on Bonterra; childClientId is caller-supplied so
    // the client here is set to convergix to isolate the depth rejection.)
    await setEngagementType("pj-cds", "project");
    await setEngagementType("pj-social-cgx", "project");
    await setParent("pj-social-cgx", "pj-cds");
    const { validateParentProjectIdAssignment } = await import("./operations-utils");
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-impact",
      childClientId: "cl-convergix",
      newParentId: "pj-social-cgx",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/max depth 2/);
  });
});

// ── Delta A: engagementType toggle guard ──────────────────

describe("Delta A engagementType toggle guard (updateProjectField)", () => {
  it("rejects toggling a nested project to 'retainer'", async () => {
    await setEngagementType("pj-cds", "retainer");
    await setParent("pj-social-cgx", "pj-cds");
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "Social Content",
      field: "engagementType",
      newValue: "retainer",
      updatedBy: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/L2-never-retainer/);
    // Row untouched.
    const child = await getProject(testDb, "pj-social-cgx");
    expect(child?.engagementType).toBeNull();
  });

  it("allows toggling a top-level project to 'retainer'", async () => {
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "engagementType",
      newValue: "retainer",
      updatedBy: "test",
    });
    expect(result.ok).toBe(true);
    const row = await getProject(testDb, "pj-cds");
    expect(row?.engagementType).toBe("retainer");
  });
});

// ── Delta A: addProject create path ───────────────────────

describe("Delta A addProject create path", () => {
  it("rejects creating a retainer-typed project with a parent link (rolled back)", async () => {
    await setEngagementType("pj-cds", "retainer");
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix",
      name: "Nested Retainer Attempt",
      engagementType: "retainer",
      parentProjectId: "pj-cds",
      updatedBy: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/L2-never-retainer/);
    // Insert rolled back — no orphan row.
    const rows = await libsqlClient.execute({
      sql: `SELECT id FROM projects WHERE name = 'Nested Retainer Attempt'`,
      args: [],
    });
    expect(rows.rows.length).toBe(0);
  });

  it("creates a project-typed child under a project umbrella (new behavior)", async () => {
    await setEngagementType("pj-cds", "project");
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix",
      name: "Umbrella Sub-Project",
      engagementType: "project",
      parentProjectId: "pj-cds",
      updatedBy: "test",
    });
    expect(result.ok).toBe(true);
    const rows = await libsqlClient.execute({
      sql: `SELECT parent_project_id, engagement_type FROM projects WHERE name = 'Umbrella Sub-Project'`,
      args: [],
    });
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].parent_project_id).toBe("pj-cds");
    expect(rows.rows[0].engagement_type).toBe("project");
  });
});

// ── Delta A: undo path revalidates nesting invariants ─────
// The #26 stale gate is same-field only; cross-field sequences could
// otherwise reconstruct a forbidden nested-retainer state through undo.

describe("Delta A undo guard (undoLastChange)", () => {
  it("rejects undo that would restore engagementType='retainer' on a since-nested project", async () => {
    // pj-cds starts retainer (raw seed), u1 retypes it to project (audit
    // row), u2 nests it under pj-social-cgx, then u1's undo would restore
    // 'retainer' onto a now-nested project.
    await setEngagementType("pj-cds", "retainer");
    const { updateProjectField } = await import("./operations-writes-project");
    const retype = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "engagementType",
      newValue: "project",
      updatedBy: "delta-u1",
    });
    expect(retype.ok).toBe(true);
    const nest = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "parentProjectId",
      newValue: "pj-social-cgx",
      updatedBy: "delta-u2",
    });
    expect(nest.ok).toBe(true);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "delta-u1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/L2-never-retainer/);
    const row = await getProject(testDb, "pj-cds");
    expect(row?.engagementType).toBe("project");
  });

  it("rejects undo that would restore a parent link onto a since-retainer-typed project", async () => {
    // u1 nests pj-cds then clears the link (audit row prev=pj-social-cgx),
    // u2 types pj-cds retainer (legal, top-level), then u1's undo would
    // re-nest a retainer-typed project.
    const { updateProjectField } = await import("./operations-writes-project");
    const nest = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "parentProjectId",
      newValue: "pj-social-cgx",
      updatedBy: "delta-u1",
    });
    expect(nest.ok).toBe(true);
    const clear = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "parentProjectId",
      newValue: "",
      updatedBy: "delta-u1",
    });
    expect(clear.ok).toBe(true);
    // createdAt is integer-seconds; nest + clear land in the same second and
    // the desc(createdAt), desc(id) tiebreak is random-id order. Bump the
    // clear row (previous_value carries the old parent id) so it is strictly
    // the newest delta-u1 change and undo targets it deterministically.
    await libsqlClient.execute({
      sql: `UPDATE updates SET created_at = created_at + 10
            WHERE updated_by = 'delta-u1' AND previous_value = 'pj-social-cgx'`,
      args: [],
    });
    const retype = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "engagementType",
      newValue: "retainer",
      updatedBy: "delta-u2",
    });
    expect(retype.ok).toBe(true);

    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "delta-u1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/L2-never-retainer/);
    const row = await getProject(testDb, "pj-cds");
    expect(row?.parentProjectId).toBeNull();
  });

  it("still allows a legal undo of a parent link (restores null)", async () => {
    const { updateProjectField } = await import("./operations-writes-project");
    const nest = await updateProjectField({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "parentProjectId",
      newValue: "pj-social-cgx",
      updatedBy: "delta-u3",
    });
    expect(nest.ok).toBe(true);
    const { undoLastChange } = await import("./operations-writes-undo");
    const result = await undoLastChange({ updatedBy: "delta-u3" });
    expect(result.ok).toBe(true);
    const row = await getProject(testDb, "pj-cds");
    expect(row?.parentProjectId).toBeNull();
  });
});

// ── Delta A: remediation path for pre-existing forbidden rows ──

describe("Delta A remediation path", () => {
  it("allows clearing the parent link on an already-nested retainer-typed row", async () => {
    // Pre-Delta-A data could hold nested retainer-typed rows (the old rule
    // only inspected the parent). The cleanup move — clearing the link —
    // must not be blocked by the new guards.
    await setEngagementType("pj-social-cgx", "retainer");
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
    const row = await getProject(testDb, "pj-social-cgx");
    expect(row?.parentProjectId).toBeNull();
    expect(row?.engagementType).toBe("retainer");
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

  it("rejects one-off parent through update_project_field path", async () => {
    await setEngagementType("pj-cds", "one-off");
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "convergix",
      projectName: "Social Content",
      field: "parentProjectId",
      newValue: "pj-cds",
      updatedBy: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/one-off/);
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
    // No engagementType setup post-Delta-A — isolates the cycle rejection.
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
