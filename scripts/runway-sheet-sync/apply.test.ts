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
import { getCurrentBatchId } from "../../src/lib/runway/runway-als";

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

describe("applyPayloads apply path", () => {
  let db: TestDb;
  let dbPath: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;
    vi.mocked(createWeekItem).mockClear();
    vi.mocked(updateWeekItemField).mockClear();
    vi.mocked(addProject).mockClear();
    vi.mocked(createWeekItem).mockResolvedValue({ ok: true, data: { title: "x" } });
    vi.mocked(updateWeekItemField).mockResolvedValue({ ok: true, data: {} });
    vi.mocked(addProject).mockResolvedValue({ ok: true, data: {} });
  });
  afterEach(() => cleanupTestDb(dbPath));

  it("(a) dispatches createWeekItem once with payload.params and records it in applied", async () => {
    const p = payload({ op: "createWeekItem", params: { clientSlug: "soundly", title: "Kickoff" } });
    const result = await applyPayloads(db, [p], { runId: "run-a", apply: true });

    expect(result.dryRun).toBe(false);
    expect(createWeekItem).toHaveBeenCalledOnce();
    expect(createWeekItem).toHaveBeenCalledWith(p.params);
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].payload).toBe(p);
    expect(result.review).toHaveLength(0);
  });

  it("(b) requiresReview:true payload is NOT dispatched, appears in review, and inserts a queue row", async () => {
    const p = payload({ requiresReview: true, reason: "needs AM sign-off" });
    const result = await applyPayloads(db, [p], { runId: "run-b", apply: true });

    expect(createWeekItem).not.toHaveBeenCalled();
    expect(result.applied).toHaveLength(0);
    expect(result.review).toHaveLength(1);
    expect(result.review[0]).toBe(p);

    const rows = await db.select().from(applyReviewQueue).where(eq(applyReviewQueue.runId, "run-b"));
    expect(rows).toHaveLength(1);
    expect(rows[0].runId).toBe("run-b");
    const parsed = JSON.parse(rows[0].payloadJson) as { requiresReview: boolean };
    expect(parsed.requiresReview).toBe(true);
  });

  it("(c) op:flag-for-review writes only to queue, no op dispatched, appears in review", async () => {
    const p = payload({ op: "flag-for-review", requiresReview: false });
    const result = await applyPayloads(db, [p], { runId: "run-c", apply: true });

    expect(createWeekItem).not.toHaveBeenCalled();
    expect(updateWeekItemField).not.toHaveBeenCalled();
    expect(addProject).not.toHaveBeenCalled();
    expect(result.applied).toHaveLength(0);
    expect(result.review).toHaveLength(1);

    const rows = await db.select().from(applyReviewQueue).where(eq(applyReviewQueue.runId, "run-c"));
    expect(rows).toHaveLength(1);
  });

  it("(d) requiresReview:true WITH opts.force:true IS dispatched", async () => {
    const p = payload({ requiresReview: true });
    const result = await applyPayloads(db, [p], { runId: "run-d", apply: true, force: true });

    expect(createWeekItem).toHaveBeenCalledOnce();
    expect(result.applied).toHaveLength(1);
    expect(result.review).toHaveLength(0);
  });

  it("(e) dispatch happens inside withBatchId(runId): getCurrentBatchId() === runId at call time", async () => {
    let capturedBatchId: string | null = null;
    vi.mocked(createWeekItem).mockImplementationOnce(async () => {
      capturedBatchId = getCurrentBatchId();
      return { ok: true, data: { title: "x" } };
    });

    const p = payload({ op: "createWeekItem" });
    await applyPayloads(db, [p], { runId: "run-e", apply: true });

    expect(capturedBatchId).toBe("run-e");
  });

  it("(f) non-ok MutationResponse does NOT throw, is recorded in applied", async () => {
    vi.mocked(createWeekItem).mockResolvedValueOnce({ ok: false, error: "client not found" });
    const p = payload({ op: "createWeekItem" });
    const result = await applyPayloads(db, [p], { runId: "run-f", apply: true });

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].response).toMatchObject({ ok: false, error: "client not found" });
  });
});
