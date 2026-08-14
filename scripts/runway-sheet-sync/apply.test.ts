import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "../../src/lib/runway/test-db";
import { applyReviewQueue } from "../../src/lib/db/runway-schema";

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
