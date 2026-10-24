import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "./test-db";
import { applyReviewQueue } from "@/lib/db/runway-schema";
import { listReviewQueue, resolveReviewQueueRow } from "./review-queue";

const flagPayload = {
  op: "flag-for-review",
  params: { weekItemId: "wi-cds-review", field: "category", sheetValue: "delivery", runwayValue: "review", policy: "flag-for-review" },
  source: { sheetId: "sheet-x", rowNumber: 12, taskNo: "1.2" },
  applyOrder: 0,
  requiresReview: true,
  preflight: { statusValid: true, categoryValid: true },
  reason: "category drift review to delivery",
};

async function insertRow(
  db: TestDb,
  row: { id: string; runId: string; createdAt: Date; payloadJson?: string },
) {
  await db.insert(applyReviewQueue).values({
    id: row.id,
    runId: row.runId,
    payloadJson: row.payloadJson ?? JSON.stringify(flagPayload),
    createdAt: row.createdAt,
  });
}

describe("listReviewQueue", () => {
  let client: Client;
  let db: TestDb;
  let dbPath: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    client = t.client;
    db = t.db;
    dbPath = t.dbPath;
  });
  afterEach(() => {
    client.close();
    cleanupTestDb(dbPath);
  });

  it("returns an inserted queue row with its run id and reason", async () => {
    await insertRow(db, { id: "rq-1", runId: "run-abc", createdAt: new Date("2026-10-20T15:00:00Z") });

    const items = await listReviewQueue(db);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "rq-1",
      runId: "run-abc",
      reason: "category drift review to delivery",
      op: "flag-for-review",
      status: null,
      resolvedAt: null,
      resolvedBy: null,
    });
    expect(items[0]!.createdAt.toISOString()).toBe("2026-10-20T15:00:00.000Z");
  });

  it("lists pending rows first, newest first within each group", async () => {
    await insertRow(db, { id: "old-pending", runId: "r", createdAt: new Date("2026-10-01T00:00:00Z") });
    await insertRow(db, { id: "new-pending", runId: "r", createdAt: new Date("2026-10-03T00:00:00Z") });
    await insertRow(db, { id: "newest-resolved", runId: "r", createdAt: new Date("2026-10-05T00:00:00Z") });
    await resolveReviewQueueRow(db, { id: "newest-resolved", status: "dismissed", resolvedBy: "operator" });

    const ids = (await listReviewQueue(db)).map((i) => i.id);

    expect(ids).toEqual(["new-pending", "old-pending", "newest-resolved"]);
  });

  it("still lists a row whose payload is not valid JSON", async () => {
    await insertRow(db, { id: "rq-bad", runId: "run-bad", createdAt: new Date(), payloadJson: "{not json" });

    const [item] = await listReviewQueue(db);

    expect(item).toMatchObject({ id: "rq-bad", runId: "run-bad", op: null, payloadUnreadable: true });
  });
});

describe("resolveReviewQueueRow", () => {
  let client: Client;
  let db: TestDb;
  let dbPath: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    client = t.client;
    db = t.db;
    dbPath = t.dbPath;
    await insertRow(db, { id: "rq-1", runId: "run-abc", createdAt: new Date("2026-10-20T15:00:00Z") });
  });
  afterEach(() => {
    client.close();
    cleanupTestDb(dbPath);
  });

  it("sets status, resolved_at and resolved_by on a pending row", async () => {
    const now = new Date("2026-10-24T12:00:00Z");
    const res = await resolveReviewQueueRow(db, { id: "rq-1", status: "approved", resolvedBy: "operator", now });

    expect(res).toEqual({ ok: true });
    const raw = await client.execute("SELECT status, resolved_at, resolved_by FROM apply_review_queue WHERE id = 'rq-1'");
    expect(raw.rows[0]).toMatchObject({
      status: "approved",
      resolved_at: Math.floor(now.getTime() / 1000),
      resolved_by: "operator",
    });
  });

  it("refuses a row that is already resolved and leaves it as it was", async () => {
    const first = new Date("2026-10-24T12:00:00Z");
    await resolveReviewQueueRow(db, { id: "rq-1", status: "dismissed", resolvedBy: "first", now: first });

    const res = await resolveReviewQueueRow(db, { id: "rq-1", status: "approved", resolvedBy: "second" });

    expect(res).toEqual({ ok: false, reason: "already-resolved" });
    const raw = await client.execute("SELECT status, resolved_at, resolved_by FROM apply_review_queue WHERE id = 'rq-1'");
    expect(raw.rows[0]).toMatchObject({
      status: "dismissed",
      resolved_at: Math.floor(first.getTime() / 1000),
      resolved_by: "first",
    });
  });

  it("reports a missing row as not found", async () => {
    const res = await resolveReviewQueueRow(db, { id: "nope", status: "approved", resolvedBy: "operator" });
    expect(res).toEqual({ ok: false, reason: "not-found" });
  });
});
