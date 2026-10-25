/**
 * The dry-run handle: reads pass through to the database, and every write
 * method throws before anything reaches it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../../src/lib/runway/test-db";
import { clients } from "../../src/lib/db/runway-schema";
import { readOnlyDb } from "./read-only-db";

/** Written out here, not imported, so a method dropped from the source list goes red. */
const WRITES = ["insert", "update", "delete", "run", "batch", "transaction", "with", "$with", "$client"];

describe("readOnlyDb", () => {
  let db: TestDb;
  let dbPath: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;
    const now = new Date();
    await db.insert(clients).values({ id: "cl-ro", name: "Acme Widgets", slug: "acme-widgets", createdAt: now, updatedAt: now });
  });
  afterEach(() => cleanupTestDb(dbPath));

  it("reads through to the database", async () => {
    const rows = await readOnlyDb(db).select({ slug: clients.slug }).from(clients).where(eq(clients.id, "cl-ro"));
    expect(rows).toEqual([{ slug: "acme-widgets" }]);
  });

  it.each(WRITES)("db.%s throws", (method) => {
    expect(() => (readOnlyDb(db) as unknown as Record<string, unknown>)[method]).toThrow(/read-only database.*only --apply writes/);
  });

  it("a blocked insert leaves the table as it was", async () => {
    const ro = readOnlyDb(db);
    const now = new Date();
    expect(() => ro.insert(clients).values({ id: "cl-x", name: "Globex", slug: "globex", createdAt: now, updatedAt: now })).toThrow();
    const before = await db.select({ id: clients.id }).from(clients);
    expect(() => ro.run(sql`DELETE FROM clients`)).toThrow();
    expect(await db.select({ id: clients.id }).from(clients)).toEqual(before);
    expect(before).toContainEqual({ id: "cl-ro" });
    expect(before).not.toContainEqual({ id: "cl-x" });
  });
});
