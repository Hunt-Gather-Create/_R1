/**
 * Anti-vacuity proofs for _R1#67 phase 1 — subtasks under work items.
 *
 * Uses the shared in-memory SQLite seed (real DB, not mocked) to prove
 * three things a passing unit suite alone does not prove:
 *
 * 1. Adding a subtask does not move the board/health/count surfaces that
 *    read week_items as if every row were a top-level work item.
 * 2. The one-level-deep rule is enforced by the write helper, not just by
 *    convention.
 * 3. A subtask's due date does not move its parent project's rolled-up
 *    start/end dates.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  getWeekItem,
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

describe("subtasks phase 1 — anti-vacuity proofs (_R1#67)", () => {
  it("proof 1: adding a subtask leaves totals.weekItems, orphan count, and the board query count unchanged", async () => {
    const { getDataHealth } = await import("./operations-reads-health");
    const { getWeekItems } = await import("@/app/runway/queries");
    const { createSubtask } = await import("./operations-writes-subtasks");

    const healthBefore = await getDataHealth();
    const boardBefore = await getWeekItems();
    const boardCountBefore = boardBefore.reduce((n, day) => n + day.items.length, 0);

    const created = await createSubtask({
      parentTaskId: "wi-cds-review",
      title: "Pull final asset list",
      updatedBy: "test-runner",
    });
    expect(created.ok).toBe(true);

    const healthAfter = await getDataHealth();
    const boardAfter = await getWeekItems();
    const boardCountAfter = boardAfter.reduce((n, day) => n + day.items.length, 0);

    expect(healthAfter.totals.weekItems).toBe(healthBefore.totals.weekItems);
    expect(healthAfter.orphans.weekItemsWithoutProject).toBe(
      healthBefore.orphans.weekItemsWithoutProject
    );
    expect(boardCountAfter).toBe(boardCountBefore);

    // The subtask row is real and findable directly by id — it just does not
    // surface through any of the top-level-work-item read paths above.
    const row = await getWeekItem(testDb, (created as { data: { id: string } }).data.id);
    expect(row).not.toBeNull();
    expect(row?.parentTaskId).toBe("wi-cds-review");
  });

  it("proof 2: a subtask cannot itself become a parent (one level deep enforced by the write helper)", async () => {
    const { createSubtask } = await import("./operations-writes-subtasks");

    const first = await createSubtask({
      parentTaskId: "wi-cds-review",
      title: "First-level subtask",
      updatedBy: "test-runner",
    });
    expect(first.ok).toBe(true);
    const subtaskId = (first as { data: { id: string } }).data.id;

    const second = await createSubtask({
      parentTaskId: subtaskId,
      title: "Attempted second-level subtask",
      updatedBy: "test-runner",
    });

    expect(second.ok).toBe(false);
    expect((second as { error: string }).error).toContain("one level deep");

    // Refused, so nothing was written under the rejected parent.
    const siblingCheck = await testDb.query.weekItems.findMany({
      where: (wi, { eq }) => eq(wi.parentTaskId, subtaskId),
    });
    expect(siblingCheck).toHaveLength(0);
  });

  it("proof 3: a subtask's due date does not move its parent project's rolled-up dates", async () => {
    const { createSubtask } = await import("./operations-writes-subtasks");
    const { recomputeProjectDates } = await import("./operations-writes-week");
    const { getProject } = await import("./test-db");

    // Establish the project's dates from its real L2 children first.
    const before = await recomputeProjectDates("pj-cds");
    const projectBefore = await getProject(testDb, "pj-cds");

    // Give a subtask a due date far outside the project's current window.
    const created = await createSubtask({
      parentTaskId: "wi-cds-review",
      title: "Far-future subtask",
      dueDate: "2027-12-31",
      updatedBy: "test-runner",
    });
    expect(created.ok).toBe(true);

    const after = await recomputeProjectDates("pj-cds");
    const projectAfter = await getProject(testDb, "pj-cds");

    expect(after).toEqual(before);
    expect(projectAfter?.startDate).toBe(projectBefore?.startDate);
    expect(projectAfter?.endDate).toBe(projectBefore?.endDate);
  });
});

describe("subtask isolation hardening (_R1#141)", () => {
  it("guard 1: assertSubtaskShape refuses a row carrying a weekOf or sectionId", async () => {
    const { assertSubtaskShape } = await import("./operations-writes-subtasks");

    expect(() =>
      assertSubtaskShape({ weekOf: "2026-04-13", sectionId: null })
    ).toThrow("createSubtask invariant violated");
    expect(() =>
      assertSubtaskShape({ weekOf: null, sectionId: "sec-1" })
    ).toThrow("createSubtask invariant violated");
    expect(() =>
      assertSubtaskShape({ weekOf: null, sectionId: null })
    ).not.toThrow();
  });

  it("guard 2: updateWeekItemField refuses a resolved row carrying parentTaskId, even one reached only by force", async () => {
    const { createSubtask } = await import("./operations-writes-subtasks");
    const { updateWeekItemField } = await import("./operations-writes-week");

    const created = await createSubtask({
      parentTaskId: "wi-cds-review",
      title: "Forced-reachable subtask",
      updatedBy: "test-runner",
    });
    expect(created.ok).toBe(true);
    const subtaskId = (created as { data: { id: string } }).data.id;

    // No real caller can give a subtask row a weekOf today — guard 1 above
    // and the write paths audited under _R1#67 both prevent it. Forcing one
    // in directly via SQL proves updateWeekItemField's own refusal holds on
    // its own, not merely as a byproduct of nothing being able to reach it.
    await libsqlClient.execute({
      sql: `UPDATE week_items SET week_of = ? WHERE id = ?`,
      args: ["2026-04-13", subtaskId],
    });

    const result = await updateWeekItemField({
      weekOf: "2026-04-13",
      weekItemTitle: "Forced-reachable subtask",
      field: "status",
      newValue: "completed",
      updatedBy: "test-runner",
    });

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain(
      "is a subtask, not a work item"
    );
  });
});
