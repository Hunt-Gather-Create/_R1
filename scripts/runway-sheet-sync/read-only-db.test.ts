/**
 * The dry-run handle: the read builders the tool uses pass through to the
 * database, and every other property throws before any SQL reaches it. Each
 * write probe runs against a scratch file database.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../../src/lib/runway/test-db";
import { clients } from "../../src/lib/db/runway-schema";
import { readOnlyDb } from "./read-only-db";

const BLOCKED = /read-only database.*only --apply writes/;

/** Raw SQL entry points, each handed an INSERT. */
const RAW_SQL = ["all", "get", "values", "run", "execute"];

/** Written out here, not imported, so a method let through by the source goes red. */
const NOT_ALLOWED = [
  "insert", "update", "delete", "batch", "transaction", "with", "$with", "$client", "$count",
  "session", "dialect", "query", "selectDistinct", "_", "schema",
];

/** Every property name on the handle and its prototype chain. */
function allProperties(obj: object): string[] {
  const names = new Set<string>();
  for (let o: object | null = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const n of Object.getOwnPropertyNames(o)) names.add(n);
  }
  return [...names];
}

describe("readOnlyDb", () => {
  let db: TestDb;
  let dbPath: string;

  const ids = async () => (await db.select({ id: clients.id }).from(clients)).map((r) => r.id).sort();

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

  it.each(RAW_SQL)("db.%s with an INSERT throws before any SQL runs, and the table is unchanged", async (method) => {
    const before = await ids();
    const ro = readOnlyDb(db) as unknown as Record<string, (q: unknown) => unknown>;
    let thrown: unknown;
    try {
      await ro[method](sql`INSERT INTO clients (id, name, slug, created_at, updated_at) VALUES ('cl-raw', 'Globex', 'globex', 0, 0)`);
    } catch (err) {
      thrown = err;
    }
    expect(String(thrown)).toMatch(BLOCKED);
    expect(await ids()).toEqual(before);
    expect(before).not.toContain("cl-raw");
  });

  it.each(NOT_ALLOWED)("db.%s throws", (method) => {
    expect(() => (readOnlyDb(db) as unknown as Record<string, unknown>)[method]).toThrow(BLOCKED);
  });

  it("every property of the raw handle but select throws", () => {
    const ro = readOnlyDb(db) as unknown as Record<string, unknown>;
    const props = allProperties(db).filter((p) => p !== "select");
    expect(props).toEqual(expect.arrayContaining(["insert", "all", "run", "session", "query"]));
    for (const p of props) expect(() => ro[p], p).toThrow(BLOCKED);
  });

  it("a blocked insert builder leaves the table as it was", async () => {
    const ro = readOnlyDb(db);
    const now = new Date();
    const before = await ids();
    expect(() => ro.insert(clients).values({ id: "cl-x", name: "Globex", slug: "globex", createdAt: now, updatedAt: now })).toThrow(BLOCKED);
    expect(await ids()).toEqual(before);
    expect(before).toEqual(expect.arrayContaining(["cl-ro"]));
    expect(before).not.toContain("cl-x");
  });
});
