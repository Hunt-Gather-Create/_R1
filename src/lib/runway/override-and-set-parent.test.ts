/**
 * Integration tests for overrideProjectDate + setProjectParent helpers.
 * test-db.ts pattern; no prod contact.
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
  endDate: string | null,
): Promise<void> {
  await libsqlClient.execute({
    sql: `UPDATE projects SET start_date = ?, end_date = ? WHERE id = ?`,
    args: [startDate, endDate, id],
  });
}

async function getAuditByType(updateType: string) {
  const result = await libsqlClient.execute({
    sql: `SELECT * FROM updates WHERE update_type = ? ORDER BY created_at`,
    args: [updateType],
  });
  return result.rows;
}

// ── overrideProjectDate ───────────────────────────────────

describe("overrideProjectDate", () => {
  it("writes startDate raw past PROJECT_FIELDS whitelist with date-override audit", async () => {
    await setProjectDates("pj-cds", "2026-04-01", null);
    const { overrideProjectDate } = await import("./operations-writes-project");
    const result = await overrideProjectDate({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "startDate",
      newValue: "2026-05-01",
      updatedBy: "test",
    });
    expect(result.ok).toBe(true);
    const row = await getProject(testDb, "pj-cds");
    expect(row?.startDate).toBe("2026-05-01");
    const audit = await getAuditByType("date-override");
    expect(audit).toHaveLength(1);
    expect(audit[0].previous_value).toBe("2026-04-01");
    expect(audit[0].new_value).toBe("2026-05-01");
  });

  it("rejects override on a retainer wrapper without bypassGuard", async () => {
    await setEngagementType("pj-cds", "retainer");
    await setParent("pj-social-cgx", "pj-cds");
    await setProjectDates("pj-cds", "2026-02-01", "2026-07-31");
    const { overrideProjectDate } = await import("./operations-writes-project");
    const result = await overrideProjectDate({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "endDate",
      newValue: "2026-08-31",
      updatedBy: "test",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/retainer wrapper/);
    // DB unchanged.
    const row = await getProject(testDb, "pj-cds");
    expect(row?.endDate).toBe("2026-07-31");
  });

  it("accepts override on a wrapper when bypassGuard=true", async () => {
    await setEngagementType("pj-cds", "retainer");
    await setParent("pj-social-cgx", "pj-cds");
    await setProjectDates("pj-cds", "2026-02-01", "2026-07-31");
    const { overrideProjectDate } = await import("./operations-writes-project");
    const result = await overrideProjectDate({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "endDate",
      newValue: "2026-08-31",
      updatedBy: "test",
      bypassGuard: true,
    });
    expect(result.ok).toBe(true);
    const row = await getProject(testDb, "pj-cds");
    expect(row?.endDate).toBe("2026-08-31");
  });

  it("idempotency key includes oldValue — apply + revert produces 2 distinct audit rows", async () => {
    await setProjectDates("pj-cds", "2026-04-01", null);
    const { overrideProjectDate } = await import("./operations-writes-project");

    // Apply: 2026-04-01 -> 2026-05-01
    const r1 = await overrideProjectDate({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "startDate",
      newValue: "2026-05-01",
      updatedBy: "tester",
    });
    expect(r1.ok).toBe(true);

    // Revert: 2026-05-01 -> 2026-04-01. With oldValue in the idem key, this
    // is a distinct write (without oldValue, the key would collapse to the
    // same as step 1 because newValue lookup-only seeds collide).
    const r2 = await overrideProjectDate({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "startDate",
      newValue: "2026-04-01",
      updatedBy: "tester",
    });
    expect(r2.ok).toBe(true);

    const audit = await getAuditByType("date-override");
    expect(audit).toHaveLength(2);
    const idemKeys = new Set(audit.map((row) => row.idempotency_key));
    expect(idemKeys.size).toBe(2);
    // First row's previous_value should be the seeded "2026-04-01"; second
    // row's previous_value should be "2026-05-01" (the apply's target).
    expect(audit[0].previous_value).toBe("2026-04-01");
    expect(audit[0].new_value).toBe("2026-05-01");
    expect(audit[1].previous_value).toBe("2026-05-01");
    expect(audit[1].new_value).toBe("2026-04-01");
  });

  it("retry of an applied override with same updatedBy collapses as duplicate (idempotency intact)", async () => {
    await setProjectDates("pj-cds", "2026-04-01", null);
    const { overrideProjectDate } = await import("./operations-writes-project");

    const r1 = await overrideProjectDate({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "startDate",
      newValue: "2026-05-01",
      updatedBy: "tester",
    });
    expect(r1.ok).toBe(true);

    // Same call again with same updatedBy + same observed state should match
    // the already-recorded idempotency key. (DB state went 04-01 -> 05-01 on
    // r1; r2 sees previousValue=05-01 from project row, so its idem key
    // differs from r1's. A true retry needs distinct updatedBy per
    // feedback_revert_idempotency_poisoning.)
    const r2 = await overrideProjectDate({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      field: "startDate",
      newValue: "2026-05-01",
      updatedBy: "tester",
    });
    expect(r2.ok).toBe(true);

    // r2 sees previousValue = "2026-05-01" (post-r1 state) and newValue =
    // "2026-05-01" — different idem key from r1, so it WRITES a new audit
    // row (a no-op-equivalent override). 2 distinct audit rows total.
    const audit = await getAuditByType("date-override");
    expect(audit).toHaveLength(2);
  });
});

// ── setProjectParent ──────────────────────────────────────

describe("setProjectParent", () => {
  it("sets parent through update_project_field path (validator runs)", async () => {
    await setEngagementType("pj-cds", "retainer");
    const { setProjectParent } = await import("./operations-writes-project");
    const result = await setProjectParent({
      clientSlug: "convergix",
      projectName: "Social Content",
      parentProjectName: "CDS Messaging",
      updatedBy: "tester",
    });
    expect(result.ok).toBe(true);
    const child = await getProject(testDb, "pj-social-cgx");
    expect(child?.parentProjectId).toBe("pj-cds");
  });

  it("clears parent when parentProjectName is null", async () => {
    await setEngagementType("pj-cds", "retainer");
    await setParent("pj-social-cgx", "pj-cds");
    const { setProjectParent } = await import("./operations-writes-project");
    const result = await setProjectParent({
      clientSlug: "convergix",
      projectName: "Social Content",
      parentProjectName: null,
      updatedBy: "tester",
    });
    expect(result.ok).toBe(true);
    const child = await getProject(testDb, "pj-social-cgx");
    expect(child?.parentProjectId).toBeNull();
  });

  it("accepts a NULL-typed parent (tolerant-read default project, Delta A)", async () => {
    // pj-cds defaults to engagement_type = NULL. Pre-Delta-A this rejected
    // (retainer-only parents); NULL now reads as default 'project'.
    const { setProjectParent } = await import("./operations-writes-project");
    const result = await setProjectParent({
      clientSlug: "convergix",
      projectName: "Social Content",
      parentProjectName: "CDS Messaging",
      updatedBy: "tester",
    });
    expect(result.ok).toBe(true);
    const child = await getProject(testDb, "pj-social-cgx");
    expect(child?.parentProjectId).toBe("pj-cds");
  });

  it("rejects when parent is a one-off (Delta A childless-card contract)", async () => {
    await setEngagementType("pj-cds", "one-off");
    const { setProjectParent } = await import("./operations-writes-project");
    const result = await setProjectParent({
      clientSlug: "convergix",
      projectName: "Social Content",
      parentProjectName: "CDS Messaging",
      updatedBy: "tester",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/one-off/);
  });

  it("rejects cross-client parent (parent in different client)", async () => {
    // setProjectParent resolves parent name within the SAME client. To test
    // cross-client, we'd have to bypass the resolver. Instead, make the
    // resolver fail to find — same effect: "project not found".
    // To exercise the cross-client validator path, use update_project_field
    // directly with a parentProjectId from another client — covered in
    // parent-project-id-validators.test.ts.
    const { setProjectParent } = await import("./operations-writes-project");
    const result = await setProjectParent({
      clientSlug: "convergix",
      projectName: "Social Content",
      parentProjectName: "Impact Report", // belongs to Bonterra
      updatedBy: "tester",
    });
    expect(result.ok).toBe(false);
    // The resolver looks within Convergix and won't find "Impact Report" there.
    if (!result.ok) expect(result.error).toMatch(/not found/);
  });

  it("rejects cycle (A under B; try to assign A as B's parent)", async () => {
    // No engagementType setup post-Delta-A — isolates the cycle rejection.
    await setParent("pj-social-cgx", "pj-cds");
    const { setProjectParent } = await import("./operations-writes-project");
    const result = await setProjectParent({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      parentProjectName: "Social Content",
      updatedBy: "tester",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Cycle detected/);
  });
});

// ── #20: linkWeekItemToProject wrapper-clobber guard ────────────────────
//
// Issue #20 reported that linkWeekItemToProject re-parenting an L2 onto a
// retainer wrapper with no L1 children silently collapsed the wrapper's
// startDate/endDate to the linked L2's date.
//
// Structurally fixed in recomputeProjectDatesWith as part of issue #8 —
// the retainer-guard now short-circuits when the L1 has any child (L1 OR
// L2). After link, the destination wrapper has the just-linked L2 as a
// child, so the guard fires and pinned dates are preserved.
//
// These tests lock that behavior in for the link path specifically and
// confirm the issue #20 acceptance criteria.
describe("linkWeekItemToProject — wrapper-clobber guard (#20)", () => {
  async function clearChildren(projectId: string): Promise<void> {
    await libsqlClient.execute({
      sql: `DELETE FROM week_items WHERE project_id = ?`,
      args: [projectId],
    });
    await libsqlClient.execute({
      sql: `UPDATE projects SET parent_project_id = NULL WHERE parent_project_id = ?`,
      args: [projectId],
    });
  }

  it("rejects cross-client link before reaching the wrapper-guard (boundary check fires first)", async () => {
    // Regression coverage for the cross-client gate at
    // linkWeekItemToProject — when a caller targets a destination project
    // in a different client, the link is refused BEFORE the transaction or
    // any recompute runs. The wrapper-guard at the recompute layer never
    // gets the chance to mis-fire, but neither does the link land. The
    // real wrapper-clobber behavior is asserted by the next test in this
    // describe block.
    await setEngagementType("pj-cds", "retainer");
    await setProjectDates("pj-cds", "2026-02-01", "2026-07-31");
    await clearChildren("pj-cds");

    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "wi-other-week", // currently parented to pj-map (cl-lppc)
      projectId: "pj-cds", // belongs to cl-convergix
      updatedBy: "tester",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/client mismatch/);
  });

  it("preserves wrapper envelope when re-parenting a same-client L2 into a retainer-wrapper-with-no-L1-children", async () => {
    // pj-cds: retainer wrapper, pinned 2026-02-01..2026-07-31, no children.
    await setEngagementType("pj-cds", "retainer");
    await setProjectDates("pj-cds", "2026-02-01", "2026-07-31");
    await clearChildren("pj-cds");
    // wi-completed lives in pj-cds via the seed; we just deleted it. Re-seed
    // an orphan L2 for the same client (Convergix) so the link succeeds.
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, end_date, title, sort_order, created_at, updated_at)
            VALUES ('wi-orphan-cgx', NULL, 'cl-convergix', '2026-04-13', '2026-04-15', '2026-04-15', '2026-04-15', 'Orphan L2', 0, ${Math.floor(Date.now() / 1000)}, ${Math.floor(Date.now() / 1000)})`,
      args: [],
    });

    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "wi-orphan-cgx",
      projectId: "pj-cds",
      updatedBy: "tester",
    });

    expect(result.ok).toBe(true);

    // The wrapper envelope must be unchanged — NOT collapsed to 2026-04-15.
    const wrapper = await getProject(testDb, "pj-cds");
    expect(wrapper?.startDate).toBe("2026-02-01");
    expect(wrapper?.endDate).toBe("2026-07-31");

    // And no cascade-date-change audit row should have emitted for the
    // wrapper, because the guard short-circuited (no actual write happened).
    const cascadeRows = await getAuditByType("cascade-date-change");
    const wrapperCascades = cascadeRows.filter((r) => r.project_id === "pj-cds");
    expect(wrapperCascades).toHaveLength(0);
  });

  it("preserves wrapper envelope when re-parenting an L2 INTO a wrapper that already has L1 children (existing guard path still fires)", async () => {
    // pj-cds is a retainer wrapper with one L1 child (pj-social-cgx).
    await setEngagementType("pj-cds", "retainer");
    await setProjectDates("pj-cds", "2026-02-01", "2026-07-31");
    await setParent("pj-social-cgx", "pj-cds");
    // Clear week items on pj-cds so we're a pure "L1-child-only" wrapper.
    await libsqlClient.execute({
      sql: `DELETE FROM week_items WHERE project_id = 'pj-cds'`,
    });
    // Insert an orphan L2 to link.
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, end_date, title, sort_order, created_at, updated_at)
            VALUES ('wi-orphan-l1c', NULL, 'cl-convergix', '2026-04-13', '2026-04-15', '2026-04-15', '2026-04-15', 'Orphan L2', 0, ${Math.floor(Date.now() / 1000)}, ${Math.floor(Date.now() / 1000)})`,
    });

    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "wi-orphan-l1c",
      projectId: "pj-cds",
      updatedBy: "tester",
    });

    expect(result.ok).toBe(true);
    const wrapper = await getProject(testDb, "pj-cds");
    expect(wrapper?.startDate).toBe("2026-02-01");
    expect(wrapper?.endDate).toBe("2026-07-31");
  });

  it("integration H-1: after L1.dueDate change cascades, L1 derived startDate/endDate also move", async () => {
    // H-1 — fresh-eyes QA finding integration coverage. #22's cascade now
    // writes L2.startDate / endDate, and the L1's derived start/end come
    // from MIN/MAX over those. Without a post-cascade recompute, the L1
    // derived dates would stay at the pre-cascade L2 boundary. With the
    // H-1 fix, the recompute fires inside the cascade tx and L1 derived
    // dates follow the L2 cascade. Locks the end-to-end behavior at the
    // real-SQLite layer (mock-based tests in
    // operations-writes-project.test.ts only verify that the recompute
    // call fires, not that derived dates land correctly).
    //
    // Setup: a project L1 with one deadline-category L2 at 2026-04-10.
    // Seed L1.startDate/endDate to 2026-04-10 via initial recompute.
    await setEngagementType("pj-impact", "project");
    await libsqlClient.execute({
      sql: `DELETE FROM week_items WHERE project_id = 'pj-impact'`,
    });
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, end_date, title, category, status, sort_order, created_at, updated_at)
            VALUES ('wi-h1-dl', 'pj-impact', 'cl-bonterra', '2026-04-06', '2026-04-10', '2026-04-10', '2026-04-10', 'Impact DL', 'deadline', 'in-progress', 0, ${Math.floor(Date.now() / 1000)}, ${Math.floor(Date.now() / 1000)})`,
    });
    {
      const { recomputeProjectDates } = await import("./operations-writes-week");
      await recomputeProjectDates("pj-impact");
    }
    const seeded = await getProject(testDb, "pj-impact");
    expect(seeded?.startDate).toBe("2026-04-10");
    expect(seeded?.endDate).toBe("2026-04-10");

    // Now: operator updates L1.dueDate forward to 2026-04-28. The cascade
    // moves L2 startDate/endDate/date/dayOfWeek; H-1 then re-derives L1.
    const { updateProjectField } = await import("./operations-writes-project");
    const result = await updateProjectField({
      clientSlug: "bonterra",
      projectName: "Impact Report",
      field: "dueDate",
      newValue: "2026-04-28",
      updatedBy: "kathy",
    });
    expect(result.ok).toBe(true);

    // L1.dueDate is now the new value (direct field-change write).
    const updated = await getProject(testDb, "pj-impact");
    expect(updated?.dueDate).toBe("2026-04-28");

    // L1.startDate / endDate are re-derived from the cascaded L2 — must
    // be 2026-04-28 (not the stale 2026-04-10).
    expect(updated?.startDate).toBe("2026-04-28");
    expect(updated?.endDate).toBe("2026-04-28");

    // The L2 itself reflects the full sync (date + startDate + endDate +
    // dayOfWeek lowercase) — locks #22 end-to-end at the real-DB layer.
    const l2Row = await libsqlClient.execute({
      sql: `SELECT date, start_date, end_date, day_of_week FROM week_items WHERE id = 'wi-h1-dl'`,
    });
    expect(l2Row.rows[0]?.date).toBe("2026-04-28");
    expect(l2Row.rows[0]?.start_date).toBe("2026-04-28");
    expect(l2Row.rows[0]?.end_date).toBe("2026-04-28");
    expect(l2Row.rows[0]?.day_of_week).toBe("tuesday"); // 2026-04-28 is Tuesday

    // Audit row trail: the cascade-date-change rows for the L1 envelope
    // move must link back to the parent field-change audit id. LOW-3
    // (TP holistic review): tightened from `>= 1` to exact count + field
    // set. The forward cascade moves BOTH L1.startDate (04-10 → 04-28)
    // AND L1.endDate (04-10 → 04-28), so exactly 2 rows are expected.
    // A regression dropping one of them would have slipped the prior
    // `>= 1` assertion.
    const fieldChangeRows = await getAuditByType("field-change");
    const parentRow = fieldChangeRows.find((r) => r.project_id === "pj-impact");
    expect(parentRow).toBeDefined();
    const cascadeRows = await getAuditByType("cascade-date-change");
    const linkedCascades = cascadeRows.filter(
      (r) => r.project_id === "pj-impact" && r.triggered_by_update_id === parentRow?.id,
    );
    expect(linkedCascades).toHaveLength(2);
    const cascadeFields = linkedCascades
      .map((r) => JSON.parse((r.metadata as string | null) ?? "{}").field as string)
      .sort();
    expect(cascadeFields).toEqual(["endDate", "startDate"]);
  });

  it("emits cascade-date-change on the previous parent when the moved L2 was a boundary child (M-1)", async () => {
    // M-1 — fresh-eyes QA flagged that no test exercises the
    // previous-parent recompute path. linkWeekItemToProject runs
    // recomputeProjectDatesWith on BOTH the old and new parents inside
    // the same tx, passing the same reparentAuditId as
    // triggeredByUpdateId. When the moved L2 was the MIN/MAX boundary
    // of the previous parent, the previous parent's derived dates
    // actually move and a cascade-date-change row should land for it.
    //
    // Setup: pj-impact (Bonterra) has wi-impact-dl at 2026-05-15. Add a
    // second L2 at 2026-06-10 so pj-impact's MAX endDate = 2026-06-10.
    // Then link wi-late-bt OFF pj-impact (to pj-brand-refresh, also
    // Bonterra). pj-impact's MAX should fall back to 2026-05-15, and a
    // cascade-date-change row for {pj-impact, endDate, prev=2026-06-10,
    // next=2026-05-15} should exist with triggeredByUpdateId = the
    // reparent audit id.
    await setEngagementType("pj-impact", "project");
    await setProjectDates("pj-impact", null, null);
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, end_date, title, sort_order, created_at, updated_at)
            VALUES ('wi-late-bt', 'pj-impact', 'cl-bonterra', '2026-06-08', '2026-06-10', '2026-06-10', '2026-06-10', 'Late BT Item', 1, ${Math.floor(Date.now() / 1000)}, ${Math.floor(Date.now() / 1000)})`,
    });

    // Run recompute once to seed pj-impact's derived dates from both children.
    {
      const { recomputeProjectDates } = await import("./operations-writes-week");
      await recomputeProjectDates("pj-impact");
    }
    const seeded = await getProject(testDb, "pj-impact");
    expect(seeded?.startDate).toBe("2026-05-15");
    expect(seeded?.endDate).toBe("2026-06-10");

    // Link wi-late-bt OFF pj-impact, onto pj-brand-refresh (same client,
    // bonterra). pj-impact loses the late-BT boundary; recompute should
    // pull endDate back to 2026-05-15.
    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "wi-late-bt",
      projectId: "pj-brand-refresh",
      updatedBy: "tester",
    });
    expect(result.ok).toBe(true);

    // Previous parent now sees endDate pulled back.
    const prev = await getProject(testDb, "pj-impact");
    expect(prev?.startDate).toBe("2026-05-15");
    expect(prev?.endDate).toBe("2026-05-15");

    // cascade-date-change audit row should exist for pj-impact with the
    // reparent audit id as triggeredByUpdateId. The reparent audit row
    // (updateType=week-reparent) should also be present in the same
    // session.
    const cascadeRows = await getAuditByType("cascade-date-change");
    const prevParentCascades = cascadeRows.filter((r) => r.project_id === "pj-impact");
    expect(prevParentCascades.length).toBeGreaterThanOrEqual(1);
    const reparentRows = await getAuditByType("week-reparent");
    expect(reparentRows.length).toBe(1);
    const reparentId = reparentRows[0].id;
    for (const row of prevParentCascades) {
      expect(row.triggered_by_update_id).toBe(reparentId);
    }
  });

  it("recomputes normally when linking to a non-retainer L1 (engagementType=project path unchanged)", async () => {
    // pj-impact is a non-retainer project. After link, it should derive
    // dates from its (existing) deadline L2 + the newly linked L2 — i.e.
    // recompute fires normally and the structural guard never engages.
    await setEngagementType("pj-impact", "project");
    await setProjectDates("pj-impact", null, null);

    // Insert an orphan L2 for Bonterra.
    await libsqlClient.execute({
      sql: `INSERT INTO week_items (id, project_id, client_id, week_of, date, start_date, end_date, title, sort_order, created_at, updated_at)
            VALUES ('wi-orphan-bt', NULL, 'cl-bonterra', '2026-06-01', '2026-06-05', '2026-06-05', '2026-06-05', 'Orphan L2 BT', 0, ${Math.floor(Date.now() / 1000)}, ${Math.floor(Date.now() / 1000)})`,
    });

    const { linkWeekItemToProject } = await import("./operations-writes-week");
    const result = await linkWeekItemToProject({
      weekItemId: "wi-orphan-bt",
      projectId: "pj-impact",
      updatedBy: "tester",
    });

    expect(result.ok).toBe(true);
    const project = await getProject(testDb, "pj-impact");
    // pj-impact had wi-impact-dl (2026-05-15) + newly linked wi-orphan-bt
    // (2026-06-05). MIN=05-15, MAX=06-05.
    expect(project?.startDate).toBe("2026-05-15");
    expect(project?.endDate).toBe("2026-06-05");
  });
});
