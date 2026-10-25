import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../../../src/lib/runway/test-db";
import { captureProdSnapshot, loadProdSnapshot, writeProdSnapshot } from "./prod-snapshot";

type SqlClient = Awaited<ReturnType<typeof createTestDb>>["client"];

/** One invented client with four week items, beside the shared seed's clients. */
async function seedSyntheticClient(client: SqlClient): Promise<void> {
  await client.execute("INSERT INTO clients (id, name, slug, created_at, updated_at) VALUES ('cl-acw', 'Acme Widgets', 'acme-widgets', 0, 0)");
  await client.execute("INSERT INTO projects (id, client_id, name, created_at, updated_at) VALUES ('pj-acw', 'cl-acw', 'Widget Page', 0, 0)");
  const items: [string, string, string | null, string, string | null, string | null][] = [
    ["wi-acw-review", "Widget Copy Review", null, "review", "Marlo", "CD: Wren"],
    ["wi-acw-deliver", "Widget Video Delivery", "in-progress", "delivery", "Wren", null],
    ["wi-acw-completed", "Widget Brief Completed", "completed", "delivery", "Marlo", null],
    ["wi-acw-canceled", "Widget Retro Canceled", "canceled", "review", "Marlo", null],
  ];
  for (const [id, title, status, category, owner, resources] of items) {
    await client.execute({
      sql: "INSERT INTO week_items (id, project_id, client_id, week_of, date, title, status, category, owner, resources, created_at, updated_at) VALUES (?, 'pj-acw', 'cl-acw', '2026-04-13', '2026-04-14', ?, ?, ?, ?, ?, 0, 0)",
      args: [id, title, status, category, owner, resources],
    });
  }
}

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
    await seedSyntheticClient(created.client);

    const snapshot = await captureProdSnapshot(db, "acme-widgets");

    expect(snapshot.client).toEqual({ id: "cl-acw", slug: "acme-widgets", name: "Acme Widgets" });
    const review = snapshot.weekItems.find((w) => w.id === "wi-acw-review");
    expect(review).toBeDefined();
    // Seeded with owner 'Marlo', resources 'CD: Wren'. Proves this query
    // actually selects both columns, not merely that the type declares them.
    expect(review?.owner).toBe("Marlo");
    expect(review?.resources).toBe("CD: Wren");
    expect(review?.category).toBe("review");

    // Staffing is frozen with the rows: this client's team, and the members.
    expect(Object.keys(snapshot.staffing?.clients ?? {})).toEqual(["acme-widgets"]);
    expect(snapshot.staffing?.members.length).toBeGreaterThan(0);

    // Every week item for this client is present, not a partial read.
    expect(snapshot.weekItems.map((w) => w.id).sort()).toEqual(
      ["wi-acw-deliver", "wi-acw-review", "wi-acw-completed", "wi-acw-canceled"].sort()
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
          owner: "Wren",
          resources: "CD: Wren",
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
