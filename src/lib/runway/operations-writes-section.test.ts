/**
 * L3 section write helpers — G3 integration coverage (plan §4.2/§4.3/§4.10,
 * D5/D6/D7, F1/F2, SP-1/SP-2/SP-3 interlocks).
 *
 * Real helpers against the in-memory test DB (test-db.ts) — mirrors the
 * batch-apply-validators.test.ts pattern: the only mock is the DB factory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Client as LibsqlClient } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  getWeekItem,
  getAuditRecords,
  type TestDb,
} from "./test-db";

let testDb: TestDb;
let libsqlClient: LibsqlClient;
let dbPath: string;

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

import {
  createSection,
  updateSectionField,
  deleteSection,
  reparentWeekItemToSection,
  reconcileSectionFromSheet,
} from "./operations-writes-section";
import { getSectionById, getSectionsForProject } from "./operations-reads-sections";
import { createWeekItem } from "./operations-writes-week";
import { getSheetSyncLedger } from "./sheet-sync-ledger-repo";
import { validateParentProjectIdAssignment } from "./operations-utils";
import { invalidateClientCache } from "./operations-utils";

beforeEach(async () => {
  const created = await createTestDb();
  testDb = created.db;
  libsqlClient = created.client;
  dbPath = created.dbPath;
  await seedTestDb(libsqlClient);
  invalidateClientCache();
});

afterEach(() => {
  libsqlClient.close();
  cleanupTestDb(dbPath);
});

async function mkSection(overrides: Partial<Parameters<typeof createSection>[0]> = {}) {
  const result = await createSection({
    projectId: "pj-cds",
    title: "Design",
    updatedBy: "tester",
    ...overrides,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.data!.sectionId;
}

// ── createSection ─────────────────────────────────────────

describe("createSection", () => {
  it("creates a pure-grouping section (all 5 actionable fields null) and audits", async () => {
    const sectionId = await mkSection();
    const row = await getSectionById(sectionId);
    expect(row).not.toBeNull();
    expect(row!.status).toBeNull();
    expect(row!.owner).toBeNull();
    expect(row!.resources).toBeNull();
    expect(row!.startDate).toBeNull();
    expect(row!.endDate).toBeNull();
    const audits = await getAuditRecords(testDb, { updateType: "new-section" });
    expect(audits).toHaveLength(1);
  });

  it("accepts actionable fields at create (status reuses the L4 enum)", async () => {
    const sectionId = await mkSection({
      title: "Development",
      status: "in-progress",
      owner: "Lane",
      startDate: "2026-05-01",
      endDate: "2026-05-20",
    });
    const row = await getSectionById(sectionId);
    expect(row!.status).toBe("in-progress");
    expect(row!.owner).toBe("Lane");
  });

  it("rejects a status outside the L4 enum (no third vocabulary)", async () => {
    const result = await createSection({
      projectId: "pj-cds",
      title: "Bad",
      status: "on-hold",
      updatedBy: "tester",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/status must be one of/);
  });

  it("rejects startDate after endDate", async () => {
    const result = await createSection({
      projectId: "pj-cds",
      title: "Bad Dates",
      startDate: "2026-06-01",
      endDate: "2026-05-01",
      updatedBy: "tester",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown project", async () => {
    const result = await createSection({
      projectId: "nope",
      title: "Orphan",
      updatedBy: "tester",
    });
    expect(result.ok).toBe(false);
  });
});

// ── updateSectionField (promotion + D6) ───────────────────

describe("updateSectionField", () => {
  it("setting an actionable field promotes; clearing demotes back to pure grouping", async () => {
    const sectionId = await mkSection();
    const promote = await updateSectionField({
      sectionId, field: "owner", newValue: "Lane", updatedBy: "tester",
    });
    expect(promote.ok).toBe(true);
    expect((await getSectionById(sectionId))!.owner).toBe("Lane");

    const demote = await updateSectionField({
      sectionId, field: "owner", newValue: "", updatedBy: "tester",
    });
    expect(demote.ok).toBe(true);
    expect((await getSectionById(sectionId))!.owner).toBeNull();
  });

  it("D6: canceled is a status flip, not a delete — children stay attached and openChildCount surfaces", async () => {
    const sectionId = await mkSection();
    const open = await createWeekItem({
      clientSlug: "convergix", title: "Open Task A", weekOf: "2026-04-13",
      sectionId, updatedBy: "tester",
    });
    expect(open.ok).toBe(true);
    const done = await createWeekItem({
      clientSlug: "convergix", title: "Done Task", weekOf: "2026-04-13",
      sectionId, status: "completed", category: "delivery", updatedBy: "tester",
    });
    expect(done.ok).toBe(true);

    const result = await updateSectionField({
      sectionId, field: "status", newValue: "canceled", updatedBy: "tester",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data!.openChildCount).toBe(1);
      expect(result.message).toMatch(/1 open task/);
    }

    // Section still exists (flip, not delete); children still attached.
    const row = await getSectionById(sectionId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("canceled");
    const audits = await getAuditRecords(testDb, { updateType: "section-field-change" });
    const meta = JSON.parse(audits[audits.length - 1].metadata!);
    expect(meta.openChildCount).toBe(1);
  });

  it("rejects unknown fields (sectionId/taskNo can never ride the generic path)", async () => {
    const sectionId = await mkSection();
    const result = await updateSectionField({
      sectionId, field: "sectionId", newValue: "x", updatedBy: "tester",
    });
    expect(result.ok).toBe(false);
  });
});

// ── deleteSection (F1 invariant 2) ────────────────────────

describe("deleteSection", () => {
  it("demotes children to loose tasks in the same transaction — never deletes them", async () => {
    const sectionId = await mkSection();
    const created = await createWeekItem({
      clientSlug: "convergix", title: "Attached Task", weekOf: "2026-04-13",
      sectionId, updatedBy: "tester",
    });
    expect(created.ok).toBe(true);

    const result = await deleteSection({ sectionId, updatedBy: "tester" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data!.demotedCount).toBe(1);

    expect(await getSectionById(sectionId)).toBeNull();
    const rows = await libsqlClient.execute(
      `SELECT id, section_id, project_id FROM week_items WHERE title = 'Attached Task'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].section_id).toBeNull();
    // Demotion keeps the project link (loose task under the same project).
    expect(rows.rows[0].project_id).toBe("pj-cds");
  });

  it("flips the section's ledger row to wi-deleted", async () => {
    const sectionId = await mkSection();
    const ledger = getSheetSyncLedger();
    const reg = await ledger.register({
      engagementKey: "cgx-cds-01", entityType: "section", sheetKey: "S1",
      runwayId: sectionId,
    });
    expect(reg.ok).toBe(true);

    await deleteSection({ sectionId, updatedBy: "tester" });
    const entry = await ledger.findByRunwayId(sectionId);
    expect(entry!.state).toBe("wi-deleted");
  });
});

// ── reparentWeekItemToSection (F1 invariant 1) ────────────

describe("reparentWeekItemToSection", () => {
  it("atomically rewrites sectionId AND projectId to the section's project", async () => {
    const sectionId = await mkSection({ projectId: "pj-impact", title: "Bonterra Phase" });
    // wi-cds-review starts under pj-cds (cl-convergix).
    const result = await reparentWeekItemToSection({
      weekItemId: "wi-cds-review", sectionId, updatedBy: "tester",
    });
    expect(result.ok).toBe(true);

    const item = await getWeekItem(testDb, "wi-cds-review");
    expect(item!.sectionId).toBe(sectionId);
    expect(item!.projectId).toBe("pj-impact");
    expect(item!.clientId).toBe("cl-bonterra");
  });

  it("detaches to a loose task with sectionId=null, keeping the project link", async () => {
    const sectionId = await mkSection();
    await reparentWeekItemToSection({
      weekItemId: "wi-cds-review", sectionId, updatedBy: "tester",
    });
    const result = await reparentWeekItemToSection({
      weekItemId: "wi-cds-review", sectionId: null, updatedBy: "tester",
    });
    expect(result.ok).toBe(true);
    const item = await getWeekItem(testDb, "wi-cds-review");
    expect(item!.sectionId).toBeNull();
    expect(item!.projectId).toBe("pj-cds");
  });
});

// ── createWeekItem: invariant 1 + D5 owner chain + taskNo ──

describe("createWeekItem with sectionId", () => {
  it("takes projectId/clientId FROM the section (invariant 1)", async () => {
    const sectionId = await mkSection();
    const result = await createWeekItem({
      title: "Sectioned Task", weekOf: "2026-04-13", sectionId, updatedBy: "tester",
    });
    expect(result.ok).toBe(true);
    const rows = await libsqlClient.execute(
      `SELECT project_id, client_id, section_id FROM week_items WHERE title = 'Sectioned Task'`,
    );
    expect(rows.rows[0].project_id).toBe("pj-cds");
    expect(rows.rows[0].client_id).toBe("cl-convergix");
    expect(rows.rows[0].section_id).toBe(sectionId);
  });

  it("rejects a conflicting projectName resolution (invariant 1)", async () => {
    const sectionId = await mkSection(); // section under pj-cds
    const result = await createWeekItem({
      clientSlug: "convergix", projectName: "Social Content",
      title: "Wrong Parent", weekOf: "2026-04-13", sectionId, updatedBy: "tester",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invariant 1/);
  });

  it("D5 owner chain: explicit owner > section.owner > project.owner", async () => {
    // pj-cds owner is 'Kathy' (seed). Section owner 'Lane'.
    const sectionId = await mkSection({ owner: "Lane" });

    const explicit = await createWeekItem({
      title: "Chain Explicit", weekOf: "2026-04-13", sectionId,
      owner: "Roz", updatedBy: "tester",
    });
    expect(explicit.ok).toBe(true);
    let rows = await libsqlClient.execute(
      `SELECT owner FROM week_items WHERE title = 'Chain Explicit'`,
    );
    expect(rows.rows[0].owner).toBe("Roz");

    const viaSection = await createWeekItem({
      title: "Chain Section", weekOf: "2026-04-13", sectionId, updatedBy: "tester",
    });
    expect(viaSection.ok).toBe(true);
    rows = await libsqlClient.execute(
      `SELECT owner FROM week_items WHERE title = 'Chain Section'`,
    );
    expect(rows.rows[0].owner).toBe("Lane");

    const plainSectionId = await mkSection({ title: "No Owner Section" });
    const viaProject = await createWeekItem({
      title: "Chain Project", weekOf: "2026-04-13",
      sectionId: plainSectionId, updatedBy: "tester",
    });
    expect(viaProject.ok).toBe(true);
    rows = await libsqlClient.execute(
      `SELECT owner FROM week_items WHERE title = 'Chain Project'`,
    );
    expect(rows.rows[0].owner).toBe("Kathy");
  });
});

describe("taskNo auto-append (plan §4.3)", () => {
  async function mkSheetSourcedSection(): Promise<string> {
    const sectionId = await mkSection({ title: "Sheet Section" });
    const reg = await getSheetSyncLedger().register({
      engagementKey: "cgx-cds-01", entityType: "section", sheetKey: "S3",
      runwayId: sectionId,
    });
    expect(reg.ok).toBe(true);
    return sectionId;
  }

  it("SP-1 + SP-3: mints max+1 numerically and registers it runway-born in the ledger", async () => {
    const sectionId = await mkSheetSourcedSection();
    for (const [title, taskNo] of [["Sib Nine", "3.9"], ["Sib Ten", "3.10"]] as const) {
      const r = await createWeekItem({
        title, weekOf: "2026-04-13", sectionId, taskNo, updatedBy: "tester",
      });
      expect(r.ok).toBe(true);
    }

    const minted = await createWeekItem({
      title: "Runway Born Task", weekOf: "2026-04-13", sectionId, updatedBy: "tester",
    });
    expect(minted.ok).toBe(true);
    const rows = await libsqlClient.execute(
      `SELECT id, task_no FROM week_items WHERE title = 'Runway Born Task'`,
    );
    expect(rows.rows[0].task_no).toBe("3.11");

    const entry = await getSheetSyncLedger().findBySheetKey("cgx-cds-01", "task", "3.11");
    expect(entry).not.toBeNull();
    expect(entry!.state).toBe("runway-born");
    expect(entry!.runwayId).toBe(rows.rows[0].id);
  });

  it("SP-2: Runway-born section (no ledger row) yields null taskNo", async () => {
    const sectionId = await mkSection({ title: "Runway Born Section" });
    const r = await createWeekItem({
      title: "First In New Section", weekOf: "2026-04-13", sectionId, updatedBy: "tester",
    });
    expect(r.ok).toBe(true);
    const rows = await libsqlClient.execute(
      `SELECT task_no FROM week_items WHERE title = 'First In New Section'`,
    );
    expect(rows.rows[0].task_no).toBeNull();
  });

  it("R11: a sheet-owned number in the ledger is skipped — the mint continues past it", async () => {
    const sectionId = await mkSheetSourcedSection();
    const sib = await createWeekItem({
      title: "Sib One", weekOf: "2026-04-13", sectionId, taskNo: "3.1", updatedBy: "tester",
    });
    expect(sib.ok).toBe(true);
    // Sheet side already owns 3.2 (registered by a prior sync run).
    const preclaim = await getSheetSyncLedger().register({
      engagementKey: "cgx-cds-01", entityType: "task", sheetKey: "3.2",
      runwayId: "someone-else",
    });
    expect(preclaim.ok).toBe(true);

    // The mint folds the engagement's ledger keys into the max computation,
    // so it hands out 3.3 — never a silent duplicate of the sheet's 3.2.
    const minted = await createWeekItem({
      title: "Collision Task", weekOf: "2026-04-13", sectionId, updatedBy: "tester",
    });
    expect(minted.ok).toBe(true);
    const rows = await libsqlClient.execute(
      `SELECT task_no FROM week_items WHERE title = 'Collision Task'`,
    );
    expect(rows.rows[0].task_no).toBe("3.3");
    const entry = await getSheetSyncLedger().findBySheetKey("cgx-cds-01", "task", "3.3");
    expect(entry!.state).toBe("runway-born");
  });
});

// ── D7 sync-respect ───────────────────────────────────────

describe("reconcileSectionFromSheet (D7 sync-respect)", () => {
  it("operator-promoted section survives a reconcile untouched on all 5 actionable fields", async () => {
    const sectionId = await mkSection({
      title: "Promoted",
      status: "in-progress",
      owner: "Lane",
      resources: "CD: Lane",
      startDate: "2026-05-01",
      endDate: "2026-05-20",
    });

    const result = await reconcileSectionFromSheet({
      sectionId, title: "Promoted (Renamed)", sortOrder: 4,
      syncRunId: "sheet-sync:test-run-1", updatedBy: "sheet-sync",
    });
    expect(result.ok).toBe(true);

    const row = await getSectionById(sectionId);
    expect(row!.title).toBe("Promoted (Renamed)");
    expect(row!.sortOrder).toBe(4);
    // The 5 actionable fields are structurally untouchable by the reconcile surface.
    expect(row!.status).toBe("in-progress");
    expect(row!.owner).toBe("Lane");
    expect(row!.resources).toBe("CD: Lane");
    expect(row!.startDate).toBe("2026-05-01");
    expect(row!.endDate).toBe("2026-05-20");
  });

  it("no-ops cleanly when title and sortOrder already match", async () => {
    const sectionId = await mkSection({ title: "Stable" });
    const result = await reconcileSectionFromSheet({
      sectionId, title: "Stable", sortOrder: 0,
      syncRunId: "sheet-sync:test-run-2", updatedBy: "sheet-sync",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toMatch(/already in sync/);
  });
});

// ── F2 depth guard ────────────────────────────────────────

describe("depth guard (F2, validator invariant 5)", () => {
  it("rejects nesting under a parent that itself has a parent (no cycle involved)", async () => {
    // Build a legit 2-level chain: retainer wrapper <- retainer child.
    await libsqlClient.execute(
      `UPDATE projects SET engagement_type = 'retainer' WHERE id IN ('pj-cds', 'pj-social-cgx')`,
    );
    await libsqlClient.execute(
      `UPDATE projects SET parent_project_id = 'pj-cds' WHERE id = 'pj-social-cgx'`,
    );
    // Third project tries to nest under the L2 — depth 3, no cycle.
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-brand",
      childClientId: "cl-convergix",
      newParentId: "pj-social-cgx",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/max depth 2/);
  });
});

// ── Ledger repo (§4.6 + §9.4 adapter) ─────────────────────

describe("sheet-sync ledger repository", () => {
  it("register rejects a sheetKey collision for the same engagement", async () => {
    const ledger = getSheetSyncLedger();
    const first = await ledger.register({
      engagementKey: "eng-1", entityType: "task", sheetKey: "2.3", runwayId: "wi-a",
    });
    expect(first.ok).toBe(true);
    const second = await ledger.register({
      engagementKey: "eng-1", entityType: "task", sheetKey: "2.3", runwayId: "wi-b",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/collision/i);
  });

  it("same sheetKey under a different engagement or entityType is fine", async () => {
    const ledger = getSheetSyncLedger();
    expect((await ledger.register({
      engagementKey: "eng-1", entityType: "task", sheetKey: "2.3", runwayId: "wi-a",
    })).ok).toBe(true);
    expect((await ledger.register({
      engagementKey: "eng-2", entityType: "task", sheetKey: "2.3", runwayId: "wi-c",
    })).ok).toBe(true);
    expect((await ledger.register({
      engagementKey: "eng-1", entityType: "section", sheetKey: "2.3", runwayId: "sec-a",
    })).ok).toBe(true);
  });

  it("markStateByRunwayId flips lifecycle state", async () => {
    const ledger = getSheetSyncLedger();
    await ledger.register({
      engagementKey: "eng-1", entityType: "task", sheetKey: "1.1", runwayId: "wi-x",
    });
    await ledger.markStateByRunwayId("wi-x", "sheet-row-missing");
    const entry = await ledger.findByRunwayId("wi-x");
    expect(entry!.state).toBe("sheet-row-missing");
  });
});

// ── Read-time derivation sanity (guardrail 1) ─────────────

describe("section reads", () => {
  it("getSectionsForProject orders by sortOrder", async () => {
    await mkSection({ title: "Zeta", sortOrder: 2 });
    await mkSection({ title: "Alpha", sortOrder: 1 });
    const rows = await getSectionsForProject("pj-cds");
    expect(rows.map((r) => r.title)).toEqual(["Alpha", "Zeta"]);
  });
});

// ─── Review-round regression coverage (C1/C2/W2/W4/W5/W7 + ledger flip) ───

import { deleteWeekItem } from "./operations-writes-week";
import { deleteProject } from "./operations-writes-project";

describe("createSection duplicate handling (C2)", () => {
  it("retry returns the LIVE existing section id, not a phantom", async () => {
    const sectionId = await mkSection({ title: "Retry Me" });
    const retry = await createSection({
      projectId: "pj-cds", title: "Retry Me", updatedBy: "tester",
    });
    expect(retry.ok).toBe(true);
    if (retry.ok) {
      expect(retry.data!.sectionId).toBe(sectionId);
      expect(retry.message).toMatch(/already exists/);
    }
  });

  it("recreating a deleted section's title works (no permanent idempotency block)", async () => {
    const first = await mkSection({ title: "Phoenix" });
    await deleteSection({ sectionId: first, updatedBy: "tester" });
    const again = await createSection({
      projectId: "pj-cds", title: "Phoenix", updatedBy: "tester",
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.data!.sectionId).not.toBe(first);
      expect(await getSectionById(again.data!.sectionId)).not.toBeNull();
    }
  });
});

describe("taskNo gap preservation past a deleted max (W2)", () => {
  it("mints past the ledger's handed-out numbers even when the max sibling was deleted", async () => {
    const sectionId = await mkSection({ title: "Gap Section" });
    await getSheetSyncLedger().register({
      engagementKey: "cgx-cds-01", entityType: "section", sheetKey: "S9",
      runwayId: sectionId,
    });
    for (const [title, taskNo] of [["Gap One", "4.1"], ["Gap Two", "4.2"]] as const) {
      const r = await createWeekItem({
        title, weekOf: "2026-04-13", sectionId, taskNo, updatedBy: "tester",
      });
      expect(r.ok).toBe(true);
    }
    // Mint 4.3 (registers in ledger), then delete it — it WAS the max.
    const minted = await createWeekItem({
      title: "Gap Three Minted", weekOf: "2026-04-13", sectionId, updatedBy: "tester",
    });
    expect(minted.ok).toBe(true);
    const mintedRow = await libsqlClient.execute(
      `SELECT id, task_no FROM week_items WHERE title = 'Gap Three Minted'`,
    );
    expect(mintedRow.rows[0].task_no).toBe("4.3");
    const del = await deleteWeekItem({
      id: String(mintedRow.rows[0].id), updatedBy: "tester",
    });
    expect(del.ok).toBe(true);

    // Next mint must be 4.4 (ledger remembers 4.3), not a 4.3 re-mint → null.
    const next = await createWeekItem({
      title: "Gap Four", weekOf: "2026-04-13", sectionId, updatedBy: "tester",
    });
    expect(next.ok).toBe(true);
    const nextRow = await libsqlClient.execute(
      `SELECT task_no FROM week_items WHERE title = 'Gap Four'`,
    );
    expect(nextRow.rows[0].task_no).toBe("4.4");
  });
});

describe("deleteWeekItem ledger flip", () => {
  it("marks the task's ledger row wi-deleted in the delete transaction", async () => {
    const sectionId = await mkSection({ title: "Del Ledger" });
    await getSheetSyncLedger().register({
      engagementKey: "cgx-cds-01", entityType: "section", sheetKey: "S8",
      runwayId: sectionId,
    });
    const created = await createWeekItem({
      title: "Del Ledger Sib", weekOf: "2026-04-13", sectionId, taskNo: "6.1",
      updatedBy: "tester",
    });
    expect(created.ok).toBe(true);
    const minted = await createWeekItem({
      title: "Del Ledger Task", weekOf: "2026-04-13", sectionId, updatedBy: "tester",
    });
    expect(minted.ok).toBe(true);
    const row = await libsqlClient.execute(
      `SELECT id FROM week_items WHERE title = 'Del Ledger Task'`,
    );
    const wiId = String(row.rows[0].id);
    await deleteWeekItem({ id: wiId, updatedBy: "tester" });
    const entry = await getSheetSyncLedger().findByRunwayId(wiId);
    expect(entry!.state).toBe("wi-deleted");
  });
});

describe("reparent taskNo + ledger hygiene (W4)", () => {
  it("clears taskNo and flags the ledger row when a numbered task changes section", async () => {
    const sectionA = await mkSection({ title: "From Section" });
    const sectionB = await mkSection({ title: "To Section" });
    await getSheetSyncLedger().register({
      engagementKey: "cgx-cds-01", entityType: "section", sheetKey: "S5",
      runwayId: sectionA,
    });
    const sib = await createWeekItem({
      title: "Numbered Sib", weekOf: "2026-04-13", sectionId: sectionA, taskNo: "5.1",
      updatedBy: "tester",
    });
    expect(sib.ok).toBe(true);
    const minted = await createWeekItem({
      title: "Numbered Mover", weekOf: "2026-04-13", sectionId: sectionA, updatedBy: "tester",
    });
    expect(minted.ok).toBe(true);
    const row = await libsqlClient.execute(
      `SELECT id, task_no FROM week_items WHERE title = 'Numbered Mover'`,
    );
    const wiId = String(row.rows[0].id);
    expect(row.rows[0].task_no).toBe("5.2");

    const moved = await reparentWeekItemToSection({
      weekItemId: wiId, sectionId: sectionB, updatedBy: "tester",
    });
    expect(moved.ok).toBe(true);
    const after = await libsqlClient.execute(
      `SELECT task_no, section_id FROM week_items WHERE id = '${wiId}'`,
    );
    expect(after.rows[0].task_no).toBeNull();
    expect(after.rows[0].section_id).toBe(sectionB);
    const entry = await getSheetSyncLedger().findByRunwayId(wiId);
    expect(entry!.state).toBe("flagged");
  });
});

describe("explicit taskNo validation (W7)", () => {
  it("rejects a taskNo without a sectionId", async () => {
    const result = await createWeekItem({
      clientSlug: "convergix", title: "Loose Numbered", weekOf: "2026-04-13",
      taskNo: "9.1", updatedBy: "tester",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/requires a sectionId/);
  });

  it("rejects a duplicate taskNo among siblings", async () => {
    const sectionId = await mkSection({ title: "Dup No Section" });
    const first = await createWeekItem({
      title: "Dup No A", weekOf: "2026-04-13", sectionId, taskNo: "7.1", updatedBy: "tester",
    });
    expect(first.ok).toBe(true);
    const second = await createWeekItem({
      title: "Dup No B", weekOf: "2026-04-13", sectionId, taskNo: "7.1", updatedBy: "tester",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already exists in this section/);
  });
});

describe("self-parent rejection (W5)", () => {
  it("rejects a top-level retainer parenting itself", async () => {
    await libsqlClient.execute(
      `UPDATE projects SET engagement_type = 'retainer' WHERE id = 'pj-cds'`,
    );
    const result = await validateParentProjectIdAssignment(testDb, {
      childId: "pj-cds",
      childClientId: "cl-convergix",
      newParentId: "pj-cds",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Cycle detected/);
  });
});

describe("deleteProject section cleanup (C1)", () => {
  it("deletes the project's sections, demotes tasks, and flips section ledger rows in one transaction", async () => {
    const sectionId = await mkSection({ title: "Doomed Section" });
    await getSheetSyncLedger().register({
      engagementKey: "cgx-cds-01", entityType: "section", sheetKey: "S7",
      runwayId: sectionId,
    });
    const created = await createWeekItem({
      title: "Doomed Task", weekOf: "2026-04-13", sectionId, updatedBy: "tester",
    });
    expect(created.ok).toBe(true);

    const result = await deleteProject({
      clientSlug: "convergix", projectName: "CDS Messaging", updatedBy: "tester",
    });
    expect(result.ok).toBe(true);

    expect(await getSectionById(sectionId)).toBeNull();
    const rows = await libsqlClient.execute(
      `SELECT project_id, section_id FROM week_items WHERE title = 'Doomed Task'`,
    );
    expect(rows.rows[0].project_id).toBeNull();
    expect(rows.rows[0].section_id).toBeNull();
    const entry = await getSheetSyncLedger().findByRunwayId(sectionId);
    expect(entry!.state).toBe("wi-deleted");
  });
});
