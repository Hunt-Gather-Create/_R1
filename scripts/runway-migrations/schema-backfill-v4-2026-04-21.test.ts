/**
 * Smoke test for the v4 schema backfill (2026-04-21).
 *
 * Runs the migration against an in-memory SQLite seeded with the real schema,
 * asserts the backfill populates expected columns, and verifies the REVERT
 * script restores prior state using the snapshot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unlinkSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Client } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "@/lib/runway/test-db";

let testDb: TestDb;
let libsqlClient: Client;
let dbPath: string;

// Per-test temp snapshot path — isolates tests from the real prod artifact
// in docs/tmp/ and prevents parallel test runs from clobbering each other.
let applySnapshotPath: string;
let drySnapshotPath: string;

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

function makeCtx(db: TestDb, dryRun: boolean) {
  const logs: string[] = [];
  return {
    db,
    dryRun,
    log: (msg: string) => logs.push(msg),
    logs,
  };
}

beforeEach(async () => {
  const created = await createTestDb();
  testDb = created.db;
  libsqlClient = created.client;
  dbPath = created.dbPath;
  await seedTestDb(libsqlClient);

  // Unique per-test snapshot path under /tmp to guarantee isolation.
  const suffix = randomUUID().slice(0, 8);
  applySnapshotPath = `/tmp/schema-backfill-v4-test-${suffix}.json`;
  drySnapshotPath = applySnapshotPath.replace(".json", "-dryrun.json");
  process.env.SCHEMA_BACKFILL_V4_SNAPSHOT_PATH = applySnapshotPath;
});

afterEach(() => {
  cleanupTestDb(dbPath);
  for (const p of [applySnapshotPath, drySnapshotPath]) {
    if (p && existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
  delete process.env.SCHEMA_BACKFILL_V4_SNAPSHOT_PATH;
});

describe("schema-backfill-v4-2026-04-21 — forward", () => {
  it("dry-run reports ops and writes a dry-run snapshot without mutating rows", async () => {
    const { up } = await import("./schema-backfill-v4-2026-04-21");
    const ctx = makeCtx(testDb, true);

    await up(ctx);

    // Verify no rows were mutated: seeded start_date is null everywhere.
    const rows = await libsqlClient.execute(
      "SELECT COUNT(*) as n FROM week_items WHERE start_date IS NOT NULL"
    );
    expect(rows.rows[0].n).toBe(0);

    // Dry-run snapshot written, apply snapshot absent.
    expect(existsSync(drySnapshotPath)).toBe(true);
    expect(existsSync(applySnapshotPath)).toBe(false);

    const snap = JSON.parse(readFileSync(drySnapshotPath, "utf8"));
    expect(snap.mode).toBe("dry-run");
    // Seeded week items have `date` set but start_date null — all 8 should be candidates.
    expect(snap.weekItems.length).toBeGreaterThan(0);
    expect(snap.projects.length).toBeGreaterThan(0);
  });

  it("apply copies date → start_date and derives project dates", async () => {
    const { up } = await import("./schema-backfill-v4-2026-04-21");
    const ctx = makeCtx(testDb, false);

    await up(ctx);

    // All seeded week items had `date` set and start_date null — now start_date = date.
    const mismatches = await libsqlClient.execute(
      "SELECT id, date, start_date FROM week_items WHERE date IS NOT NULL AND (start_date IS NULL OR start_date != date)"
    );
    expect(mismatches.rows.length).toBe(0);

    // Spot-check a derived project. pj-cds has children with dates 2026-04-13..2026-04-16.
    const project = await libsqlClient.execute({
      sql: "SELECT start_date, end_date FROM projects WHERE id = ?",
      args: ["pj-cds"],
    });
    const row = project.rows[0];
    expect(row.start_date).toBe("2026-04-13"); // wi-completed is on 2026-04-13
    expect(row.end_date).toBe("2026-04-16"); // wi-cds-deliver is on 2026-04-16

    // Apply snapshot written with pre-state captured.
    expect(existsSync(applySnapshotPath)).toBe(true);
    const snap = JSON.parse(readFileSync(applySnapshotPath, "utf8"));
    expect(snap.mode).toBe("apply");
    // Pre-values: all week_items previously had start_date null.
    for (const op of snap.weekItems) {
      expect(op.previousStartDate).toBeNull();
    }
  });

  it("apply is effectively idempotent — second run changes nothing", async () => {
    const { up } = await import("./schema-backfill-v4-2026-04-21");

    await up(makeCtx(testDb, false));
    const firstSnap = JSON.parse(readFileSync(applySnapshotPath, "utf8"));
    expect(firstSnap.weekItems.length).toBeGreaterThan(0);

    await up(makeCtx(testDb, false));
    const secondSnap = JSON.parse(readFileSync(applySnapshotPath, "utf8"));

    // Second run: no week_items need backfill (all already set), no project deltas.
    expect(secondSnap.weekItems.length).toBe(0);
    expect(secondSnap.projects.length).toBe(0);
  });
});

describe("schema-backfill-v4-2026-04-21-REVERT", () => {
  it("aborts when snapshot file is missing", async () => {
    const { up: revertUp } = await import("./schema-backfill-v4-2026-04-21-REVERT");
    await expect(revertUp(makeCtx(testDb, true))).rejects.toThrow(/Snapshot not found/);
  });

  it("restores week_items.start_date and projects.start_date/end_date", async () => {
    // 1. Apply the forward migration.
    const { up } = await import("./schema-backfill-v4-2026-04-21");
    await up(makeCtx(testDb, false));

    // Sanity: post-apply state has start_date populated.
    let row = await libsqlClient.execute({
      sql: "SELECT start_date FROM week_items WHERE id = ?",
      args: ["wi-cds-review"],
    });
    expect(row.rows[0].start_date).toBe("2026-04-14");

    // 2. Apply the REVERT migration.
    const { up: revertUp } = await import("./schema-backfill-v4-2026-04-21-REVERT");
    await revertUp(makeCtx(testDb, false));

    // 3. week_items.start_date restored to null (pre-state).
    row = await libsqlClient.execute({
      sql: "SELECT start_date FROM week_items WHERE id = ?",
      args: ["wi-cds-review"],
    });
    expect(row.rows[0].start_date).toBeNull();

    // 4. projects.start_date/end_date restored to null (pre-state).
    row = await libsqlClient.execute({
      sql: "SELECT start_date, end_date FROM projects WHERE id = ?",
      args: ["pj-cds"],
    });
    expect(row.rows[0].start_date).toBeNull();
    expect(row.rows[0].end_date).toBeNull();
  });

  it("warns when snapshot mode is 'dry-run'", async () => {
    // Seed a dry-run snapshot manually.
    writeFileSync(
      applySnapshotPath,
      JSON.stringify({
        capturedAt: new Date().toISOString(),
        mode: "dry-run",
        weekItems: [],
        projects: [],
      }),
      "utf8"
    );

    const { up: revertUp } = await import("./schema-backfill-v4-2026-04-21-REVERT");
    const ctx = makeCtx(testDb, true);
    await revertUp(ctx);

    const warningLogged = ctx.logs.some((l) => l.includes('mode is "dry-run"'));
    expect(warningLogged).toBe(true);
  });
});
