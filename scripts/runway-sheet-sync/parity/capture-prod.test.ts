/**
 * --capture-prod reads through the read-only handle. The capture is spied,
 * so the handle it received is the one checked. Scratch file database only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../../../src/lib/runway/test-db";
import { clients } from "../../../src/lib/db/runway-schema";
import { captureProd } from "./cli";
import { captureProdSnapshot } from "./prod-snapshot";

vi.mock("./prod-snapshot", async (original) => {
  const real = await original<typeof import("./prod-snapshot")>();
  return { ...real, captureProdSnapshot: vi.fn(real.captureProdSnapshot) };
});

describe("captureProd, the --capture-prod call site", () => {
  let db: TestDb;
  let dbPath: string;
  let outDir: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;
    const now = new Date();
    await db.insert(clients).values({ id: "cl-cap", name: "Acme Widgets", slug: "acme-widgets", createdAt: now, updatedAt: now });
    outDir = mkdtempSync(join(tmpdir(), "parity-capture-"));
    vi.mocked(captureProdSnapshot).mockClear();
  });

  afterEach(() => {
    cleanupTestDb(dbPath);
    rmSync(outDir, { recursive: true, force: true });
  });

  it("given the raw handle, the capture reads through one on which an insert throws, and still writes the snapshot", async () => {
    const outPath = join(outDir, "prod.json");
    await captureProd(db, "acme-widgets", outPath);

    expect(vi.mocked(captureProdSnapshot)).toHaveBeenCalledTimes(1);
    const handle = vi.mocked(captureProdSnapshot).mock.calls[0][0];
    const now = new Date();
    expect(() => handle.insert(clients).values({ id: "cl-new", name: "Globex", slug: "globex", createdAt: now, updatedAt: now })).toThrow(
      /read-only database.*only --apply writes/,
    );
    expect(existsSync(outPath)).toBe(true);
    expect(JSON.parse(readFileSync(outPath, "utf8")).client).toEqual({ id: "cl-cap", slug: "acme-widgets", name: "Acme Widgets" });
  });
});
