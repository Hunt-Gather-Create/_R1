import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  assertSnapshotNotOverwritten,
  buildMigrationDb,
  createMigrationContext,
  deriveMigrationBatchId,
  validateMigrationModule,
  type MigrationContext,
} from "./runway-migrate";
import { withDryRun } from "@/lib/runway/runway-als";
import { projects } from "@/lib/db/runway-schema";
import { createTestDb, seedTestDb, cleanupTestDb, getProject } from "@/lib/runway/test-db";

describe("assertSnapshotNotOverwritten (#150 defect 2)", () => {
  const snapshotPath = "data/runway-snapshot.json";

  it("refuses when --apply would overwrite an existing snapshot without --force-snapshot", () => {
    expect(() =>
      assertSnapshotNotOverwritten({
        shouldApply: true,
        forceSnapshot: false,
        snapshotExists: true,
        snapshotPath,
      })
    ).toThrow(/force-snapshot/);
  });

  it("proceeds when --force-snapshot is passed", () => {
    expect(() =>
      assertSnapshotNotOverwritten({
        shouldApply: true,
        forceSnapshot: true,
        snapshotExists: true,
        snapshotPath,
      })
    ).not.toThrow();
  });

  it("proceeds when no snapshot exists yet", () => {
    expect(() =>
      assertSnapshotNotOverwritten({
        shouldApply: true,
        forceSnapshot: false,
        snapshotExists: false,
        snapshotPath,
      })
    ).not.toThrow();
  });

  it("proceeds on a dry run regardless of an existing snapshot, since dry runs don't write one", () => {
    expect(() =>
      assertSnapshotNotOverwritten({
        shouldApply: false,
        forceSnapshot: false,
        snapshotExists: true,
        snapshotPath,
      })
    ).not.toThrow();
  });
});

describe("createMigrationContext", () => {
  it("creates context with dryRun=true by default", () => {
    const ctx = createMigrationContext({} as MigrationContext["db"], true);
    expect(ctx.dryRun).toBe(true);
  });

  it("creates context with dryRun=false when specified", () => {
    const ctx = createMigrationContext({} as MigrationContext["db"], false);
    expect(ctx.dryRun).toBe(false);
  });

  it("log function captures messages", () => {
    const ctx = createMigrationContext({} as MigrationContext["db"], true);
    ctx.log("test message");
    ctx.log("another message");
    expect(ctx.logs).toEqual(["test message", "another message"]);
  });

  it("provides the db instance", () => {
    const mockDb = { select: vi.fn() };
    const ctx = createMigrationContext(mockDb as unknown as MigrationContext["db"], true);
    expect(ctx.db).toBe(mockDb);
  });
});

describe("#150: a migration's ctx.db is wrapped the same as getRunwayDb()", () => {
  let dbPath: string;

  it("refuses a direct ctx.db.update() write under a dry run, and applies it otherwise", async () => {
    const testDb = await createTestDb();
    dbPath = testDb.dbPath;
    await seedTestDb(testDb.client);

    // The actual call site: buildMigrationDb is what run() calls to build
    // the object handed to a migration's up() as ctx.db.
    const wrappedDb = buildMigrationDb(testDb.client);

    const before = await getProject(testDb.db, "pj-social-cgx");
    expect(before?.status).toBe("not-started");

    // A migration that writes via ctx.db directly, like the 5 real
    // migrations in scripts/runway-migrations that never call
    // updateProjectStatus/updateProjectField/updateWeekItemField.
    const writeViaCtxDb = async () =>
      wrappedDb.update(projects).set({ status: "awaiting-client" }).where(eq(projects.id, "pj-social-cgx"));

    await expect(withDryRun(true, writeViaCtxDb)).rejects.toThrow(/dry-run/i);

    const afterDryRun = await getProject(testDb.db, "pj-social-cgx");
    expect(afterDryRun?.status).toBe("not-started");

    await writeViaCtxDb();
    const afterApply = await getProject(testDb.db, "pj-social-cgx");
    expect(afterApply?.status).toBe("awaiting-client");

    cleanupTestDb(dbPath);
  });
});

describe("migration script format", () => {
  it("migration context supports dry-run logging without DB writes", async () => {
    const ctx = createMigrationContext({} as MigrationContext["db"], true);

    // Simulate a migration function
    async function up(migCtx: MigrationContext) {
      migCtx.log("Deactivating Ronan Lane");
      if (!migCtx.dryRun) {
        // Would write to DB
      }
      migCtx.log("Done");
    }

    await up(ctx);
    expect(ctx.logs).toEqual(["Deactivating Ronan Lane", "Done"]);
  });

  it("migration context allows DB writes when not dry-run", async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    const mockDb = { update: mockUpdate };
    const ctx = createMigrationContext(mockDb as unknown as MigrationContext["db"], false);

    async function up(migCtx: MigrationContext) {
      migCtx.log("Deactivating Ronan Lane");
      if (!migCtx.dryRun) {
        await migCtx.db.update({}).set({}).where({});
      }
    }

    await up(ctx);
    expect(mockUpdate).toHaveBeenCalled();
    expect(ctx.logs).toEqual(["Deactivating Ronan Lane"]);
  });
});

describe("deriveMigrationBatchId", () => {
  it("strips the directory path", () => {
    expect(deriveMigrationBatchId("scripts/runway-migrations/001-example.ts")).toBe(
      "001-example",
    );
  });

  it("strips the file extension", () => {
    expect(deriveMigrationBatchId("my-migration.ts")).toBe("my-migration");
    expect(deriveMigrationBatchId("my-migration.js")).toBe("my-migration");
  });

  it("preserves alphanumerics, underscores, and hyphens", () => {
    expect(deriveMigrationBatchId("bonterra-cleanup_2026-04-19.ts")).toBe(
      "bonterra-cleanup_2026-04-19",
    );
  });

  it("strips characters outside [a-zA-Z0-9_-]", () => {
    const result = deriveMigrationBatchId("my-migration.2026-04-20.ts");
    expect(result).toBe("my-migration.2026-04-20".replace(/\./g, ""));
    expect(result).toMatch(/^[a-zA-Z0-9_\-]+$/);
  });

  it("strips spaces and special characters", () => {
    const result = deriveMigrationBatchId("weird name!@#$%^&*().ts");
    expect(result).toBe("weirdname");
    expect(result).toMatch(/^[a-zA-Z0-9_\-]*$/);
  });

  it("returns only characters in the allowed set for any input", () => {
    const inputs = [
      "scripts/foo/bar.ts",
      "/abs/path/to/mig-2026_04_20.ts",
      "with spaces.ts",
      "unicode-é-name.ts",
    ];
    for (const input of inputs) {
      expect(deriveMigrationBatchId(input)).toMatch(/^[a-zA-Z0-9_\-]*$/);
    }
  });
});

describe("validateMigrationModule", () => {
  it("accepts a valid migration module", () => {
    const valid = {
      description: "Test migration",
      up: async () => {},
    };
    expect(() => validateMigrationModule(valid, "test.ts")).not.toThrow();
  });

  it("rejects module with missing description", () => {
    const invalid = { up: async () => {} };
    expect(() => validateMigrationModule(invalid, "test.ts")).toThrow(
      'missing or non-string "description"'
    );
  });

  it("rejects module with non-string description", () => {
    const invalid = { description: 42, up: async () => {} };
    expect(() => validateMigrationModule(invalid, "test.ts")).toThrow(
      'missing or non-string "description"'
    );
  });

  it("rejects module with missing up function", () => {
    const invalid = { description: "Test" };
    expect(() => validateMigrationModule(invalid, "test.ts")).toThrow(
      'missing or non-function "up"'
    );
  });

  it("rejects module with non-function up", () => {
    const invalid = { description: "Test", up: "not a function" };
    expect(() => validateMigrationModule(invalid, "test.ts")).toThrow(
      'missing or non-function "up"'
    );
  });
});
