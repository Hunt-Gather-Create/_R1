import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "../../src/lib/runway/test-db";
import { applyReviewQueue } from "../../src/lib/db/runway-schema";
import { applyPayloads } from "./apply";
import type { SyncPayload } from "./types";

vi.mock("../../src/lib/runway/operations", () => ({
  createWeekItem: vi.fn(async () => ({ ok: true, data: { title: "x" } })),
  updateWeekItemField: vi.fn(async () => ({ ok: true, data: {} })),
  addProject: vi.fn(async () => ({ ok: true, data: {} })),
}));
import { createWeekItem, updateWeekItemField, addProject } from "../../src/lib/runway/operations";

function payload(over: Partial<SyncPayload>): SyncPayload {
  return {
    op: "createWeekItem",
    params: { clientSlug: "soundly", title: "Kickoff" },
    source: { sheetId: "s", rowNumber: 12, taskNo: "1.1" },
    applyOrder: 0,
    requiresReview: false,
    preflight: { statusValid: true, categoryValid: true },
    reason: "new leaf",
    ...over,
  };
}

describe("applyPayloads dry-run (default)", () => {
  let db: TestDb;
  let dbPath: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;
  });
  afterEach(() => cleanupTestDb(dbPath));

  it("returns dryRun=true, sorted planned, empty applied/review, calls no ops", async () => {
    const payloads = [
      payload({ applyOrder: 2, reason: "second" }),
      payload({ applyOrder: 0, reason: "first" }),
    ];
    const result = await applyPayloads(db, payloads, { runId: "run-1" });

    expect(result.dryRun).toBe(true);
    expect(result.planned.map((p) => p.applyOrder)).toEqual([0, 2]);
    expect(result.applied).toEqual([]);
    expect(result.review).toEqual([]);

    expect(createWeekItem).not.toHaveBeenCalled();
    expect(updateWeekItemField).not.toHaveBeenCalled();
    expect(addProject).not.toHaveBeenCalled();
  });
});

describe("apply_review_queue schema", () => {
  let db: TestDb;
  let dbPath: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;
  });
  afterEach(() => cleanupTestDb(dbPath));

  it("stores and reads back a flagged payload row", async () => {
    await db.insert(applyReviewQueue).values({
      id: "arq_1",
      runId: "run-1",
      payloadJson: JSON.stringify({ op: "flag-for-review", reason: "needs AM" }),
      createdAt: new Date(1_700_000_000_000),
    });
    const rows = await db
      .select()
      .from(applyReviewQueue)
      .where(eq(applyReviewQueue.runId, "run-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("arq_1");
    expect(JSON.parse(rows[0].payloadJson).op).toBe("flag-for-review");
  });
});
