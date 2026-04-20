import { describe, it, expect, vi } from "vitest";
import {
  createMigrationContext,
  deriveMigrationBatchId,
  validateMigrationModule,
  type MigrationContext,
} from "./runway-migrate";

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
