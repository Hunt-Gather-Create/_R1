import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../../../src/lib/runway/test-db";
import { captureProdSnapshot, loadProdSnapshot, writeProdSnapshot } from "./prod-snapshot";

describe("captureProdSnapshot, the independent instrument", () => {
  let dbPath: string;
  let db: TestDb;

  afterEach(() => {
    if (dbPath) cleanupTestDb(dbPath);
  });

  it("reads owner and resources, the exact fields runway-read.ts's readClientBundle never selects", async () => {
    const created = await createTestDb();
    db = created.db;
    dbPath = created.dbPath;
    await seedTestDb(created.client);

    const snapshot = await captureProdSnapshot(db, "convergix");

    expect(snapshot.client).toEqual({ id: "cl-convergix", slug: "convergix", name: "Convergix" });
    const review = snapshot.weekItems.find((w) => w.id === "wi-cds-review");
    expect(review).toBeDefined();
    // Seeded exactly as owner: 'Kathy', resources: 'Roz'. Proves this query
    // actually selects both columns, not merely that the type declares them.
    expect(review?.owner).toBe("Kathy");
    expect(review?.resources).toBe("Roz");
    expect(review?.category).toBe("review");

    // Every week item for this client is present, not a partial read.
    expect(snapshot.weekItems.map((w) => w.id).sort()).toEqual(
      ["wi-cds-deliver", "wi-cds-review", "wi-completed", "wi-canceled"].sort()
    );
  });

  it("throws on an unknown client slug rather than returning an empty snapshot", async () => {
    const created = await createTestDb();
    db = created.db;
    dbPath = created.dbPath;
    await seedTestDb(created.client);
    await expect(captureProdSnapshot(db, "no-such-client")).rejects.toThrow(/not found/);
  });
});

describe("writeProdSnapshot / loadProdSnapshot, freeze round-trip", () => {
  it("round-trips byte-for-byte on reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "parity-snapshot-"));
    const path = join(dir, "snapshot.json");
    const snapshot = {
      clientSlug: "acme",
      capturedAt: "2026-09-07T22:00:00.000Z",
      client: { id: "c-1", slug: "acme", name: "Acme" },
      projects: [{ id: "p-1", name: "Widget", status: null, category: null, notes: null }],
      weekItems: [
        {
          id: "wi-1",
          projectId: "p-1",
          title: "Kickoff",
          weekOf: "2026-06-01",
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          status: "scheduled",
          category: null,
          owner: "Lane",
          resources: "CD: Lane",
          notes: null,
        },
      ],
    };
    writeProdSnapshot(snapshot, path);
    const reloaded = loadProdSnapshot(path);
    expect(reloaded).toEqual(snapshot);

    // Re-writing the identical snapshot produces byte-identical file content.
    const bytesBefore = readFileSync(path, "utf8");
    writeProdSnapshot(snapshot, path);
    expect(readFileSync(path, "utf8")).toBe(bytesBefore);

    rmSync(dir, { recursive: true, force: true });
  });
});
