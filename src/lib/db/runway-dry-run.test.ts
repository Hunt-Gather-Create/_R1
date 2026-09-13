/**
 * #150: a dry-run migration must never write to the database it is pointed
 * at. The bug this pins: `dryRun` used to be a log-prefix label only, so
 * `updateProjectStatus` (and every other write helper, since each calls
 * `getRunwayDb()` for itself) wrote through a "dry run" exactly like an
 * apply. The 2026-09-07 incident: a dry run wrote 27 ops to prod, and the
 * apply pass that followed recorded the already-mutated state as the
 * "pre-state" snapshot.
 *
 * These tests exercise the real call site, `updateProjectStatus` against a
 * real SQLite-backed `getRunwayDb()` connection, not a mock of the write
 * path. A test that only checks the log prefix would have missed the bug
 * that shipped; this one asserts the row itself.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  getProject,
} from "@/lib/runway/test-db";
import {
  pinRunwayConnection,
  resetRunwayConnectionForTests,
  getRunwayDb,
} from "@/lib/db/runway";
import { withDryRun } from "@/lib/runway/runway-als";
import { updateProjectStatus } from "@/lib/runway/operations-writes";
import { projects } from "@/lib/db/runway-schema";

describe("#150: getRunwayDb() refuses writes under withDryRun(true)", () => {
  let dbPath: string;

  beforeEach(async () => {
    const testDb = await createTestDb();
    dbPath = testDb.dbPath;
    await seedTestDb(testDb.client);
    resetRunwayConnectionForTests();
    pinRunwayConnection(`file:${dbPath}`);
  });

  afterEach(() => {
    resetRunwayConnectionForTests();
    cleanupTestDb(dbPath);
  });

  it("does not change the row when updateProjectStatus runs under withDryRun(true)", async () => {
    const before = await getProject(getRunwayDb(), "pj-social-cgx");
    expect(before?.status).toBe("not-started");

    await expect(
      withDryRun(true, () =>
        updateProjectStatus({
          clientSlug: "convergix",
          projectName: "Social Content",
          newStatus: "awaiting-client",
          updatedBy: "test-runner",
        })
      )
    ).rejects.toThrow(/dry-run/i);

    const after = await getProject(getRunwayDb(), "pj-social-cgx");
    expect(after?.status).toBe(before?.status);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("changes the row when the same call runs outside any withDryRun scope (--apply)", async () => {
    const before = await getProject(getRunwayDb(), "pj-social-cgx");
    expect(before?.status).toBe("not-started");

    const result = await updateProjectStatus({
      clientSlug: "convergix",
      projectName: "Social Content",
      newStatus: "awaiting-client",
      updatedBy: "test-runner",
    });
    expect(result.ok).toBe(true);

    const after = await getProject(getRunwayDb(), "pj-social-cgx");
    expect(after?.status).toBe("awaiting-client");
  });

  it("lets a read-only call through cleanly under withDryRun(true)", async () => {
    const rows = await withDryRun(true, () =>
      getRunwayDb().select().from(projects)
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
