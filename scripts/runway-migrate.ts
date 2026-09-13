/**
 * Runway Migrate — Run migration scripts against the Runway DB
 *
 * Usage:
 *   pnpm runway:migrate scripts/runway-migrations/001-example.ts           # Dry-run (default)
 *   pnpm runway:migrate scripts/runway-migrations/001-example.ts --apply   # Apply changes
 *   pnpm runway:migrate scripts/runway-migrations/001-example.ts --apply --target prod  # Prod (requires confirmation)
 *   pnpm runway:migrate scripts/runway-migrations/001-example.ts --apply --target prod --yes  # Skip confirmation
 *   pnpm runway:migrate scripts/runway-migrations/001-example.ts --apply --force-snapshot  # Overwrite an existing pre-apply snapshot
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { existsSync } from "fs";
import { resolve, basename, extname } from "path";
import { createInterface } from "readline";
import { runIfDirect } from "./lib/run-script";
import { withBatchId, withDryRun } from "@/lib/runway/runway-als";
import { SNAPSHOT_PATH } from "./runway-pull";

// ── Types ──────────────────────────────────────────────────

type DrizzleDb = ReturnType<typeof drizzle>;

export interface MigrationContext {
  db: DrizzleDb;
  dryRun: boolean;
  log: (message: string) => void;
  logs: string[];
}

export interface MigrationModule {
  description: string;
  up: (ctx: MigrationContext) => Promise<void>;
  down?: (ctx: MigrationContext) => Promise<void>;
}

// ── Core (exported for testing) ────────────────────────────

/** Validate that a dynamically imported module has the required migration shape. */
export function validateMigrationModule(mod: unknown, path: string): MigrationModule {
  const m = mod as Record<string, unknown>;
  if (!m.description || typeof m.description !== "string") {
    throw new Error(`Invalid migration: missing or non-string "description" export in ${path}`);
  }
  if (!m.up || typeof m.up !== "function") {
    throw new Error(`Invalid migration: missing or non-function "up" export in ${path}`);
  }
  return m as unknown as MigrationModule;
}

/**
 * Derive a safe batchId from a migration file path.
 *
 * Strips the directory and extension, then removes any character outside
 * `[a-zA-Z0-9_-]`. The hyphen is escaped in the character class to remove
 * any ambiguity about range interpretation.
 */
export function deriveMigrationBatchId(migrationPath: string): string {
  return basename(migrationPath, extname(migrationPath)).replace(
    /[^a-zA-Z0-9_\-]/g,
    "",
  );
}

export function createMigrationContext(db: DrizzleDb, dryRun: boolean): MigrationContext {
  const logs: string[] = [];
  return {
    db,
    dryRun,
    log: (message: string) => {
      logs.push(message);
      console.log(`  ${dryRun ? "[DRY-RUN]" : "[APPLY]"} ${message}`);
    },
    logs,
  };
}

/**
 * #150 defect 2: the pre-apply snapshot at SNAPSHOT_PATH is the only thing a
 * REVERT script can trust as "before this batch ran." If `--apply` overwrites
 * it while one is already sitting there, a later revert restores to the
 * wrong pre-state without any error — that is what turned the 2026-09-07 dry
 * run into an inert revert. `--force-snapshot` is the explicit opt-in to
 * overwrite it anyway (e.g. the existing file is stale from an unrelated run).
 */
export function assertSnapshotNotOverwritten(opts: {
  shouldApply: boolean;
  forceSnapshot: boolean;
  snapshotExists: boolean;
  snapshotPath: string;
}): void {
  if (!opts.shouldApply || opts.forceSnapshot || !opts.snapshotExists) return;
  throw new Error(
    `Refusing to apply: a snapshot already exists at ${opts.snapshotPath}. ` +
      `--apply captures a fresh pre-state snapshot there before writing, and would ` +
      `overwrite the existing one before anyone confirmed it isn't this batch's real ` +
      `pre-state. Pass --force-snapshot to overwrite it anyway.`
  );
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${prompt} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "yes");
    });
  });
}

// ── CLI ────────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);

  const migrationPath = args.find((a) => !a.startsWith("--"));
  if (!migrationPath) {
    console.error("Usage: pnpm runway:migrate <path-to-migration.ts> [--apply] [--target prod] [--yes]");
    process.exit(1);
  }

  const shouldApply = args.includes("--apply");
  const targetIdx = args.indexOf("--target");
  const target = targetIdx !== -1 ? args[targetIdx + 1] : "local";
  const skipConfirm = args.includes("--yes");
  const forceSnapshot = args.includes("--force-snapshot");

  try {
    assertSnapshotNotOverwritten({
      shouldApply,
      forceSnapshot,
      snapshotExists: existsSync(SNAPSHOT_PATH),
      snapshotPath: SNAPSHOT_PATH,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Determine DB URL
  const isProd = target === "prod";
  const url = isProd
    ? process.env.RUNWAY_DATABASE_URL
    : (process.env.RUNWAY_DATABASE_URL ?? "file:runway-local.db");

  if (isProd && !url) {
    console.error("RUNWAY_DATABASE_URL is not set. Cannot target prod.");
    process.exit(1);
  }

  // Safety: prod requires explicit confirmation
  if (isProd && shouldApply && !skipConfirm) {
    console.log(`\n⚠ You are about to apply a migration to PRODUCTION: ${url}`);
    const confirmed = await confirm("Are you sure?");
    if (!confirmed) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  // Load and validate the migration module
  const fullPath = resolve(process.cwd(), migrationPath);
  const allowedDir = resolve(process.cwd(), "scripts/runway-migrations");
  if (!fullPath.startsWith(allowedDir + "/") || !/\.(ts|js)$/.test(fullPath)) {
    console.error(`Migration path must be a .ts or .js file inside scripts/runway-migrations/.\nGot: ${fullPath}`);
    process.exit(1);
  }

  let migration: MigrationModule;
  try {
    const imported = await import(fullPath);
    migration = validateMigrationModule(imported, migrationPath);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log(`\nMigration: ${migration.description}`);
  console.log(`Target: ${target} (${url})`);
  console.log(`Mode: ${shouldApply ? "APPLY" : "DRY-RUN"}\n`);

  // Connect
  const client = createClient({ url: url!, authToken: process.env.RUNWAY_AUTH_TOKEN });
  const db = drizzle(client);

  // Auto-snapshot before applying
  if (shouldApply) {
    try {
      const { execSync } = await import("child_process");
      console.log("Creating pre-migration snapshot...");
      execSync("npx tsx scripts/runway-pull.ts", { stdio: "inherit" });
      console.log("");
    } catch {
      console.warn("Warning: Could not create pre-migration snapshot. Proceeding anyway.\n");
    }
  }

  // Derive batchId from migration filename for audit tagging
  const migrationBatchId = deriveMigrationBatchId(migrationPath);

  // Run migration. #17: when applying, scope the migration batchId to the
  // migration callback via AsyncLocalStorage so audit rows are tagged.
  // Dry-runs skip the scope — they're side-effect-free and don't write audit.
  const ctx = createMigrationContext(db, !shouldApply);

  const runMigration = async () => {
    try {
      await migration.up(ctx);
      console.log(`\n${shouldApply ? "Migration applied." : "Dry-run complete. Use --apply to execute."}`);
      console.log(`${ctx.logs.length} operation(s) logged.`);
      if (shouldApply) {
        console.log(`\nTo publish changes to Slack, run:`);
        console.log(`  pnpm runway:publish-updates --batch "${migrationBatchId}"`);
      }
    } catch (err) {
      console.error("\nMigration failed:", err);
      process.exit(1);
    }
  };

  // #150: the runner is the only place that knows whether this is a real
  // apply. Set the dry-run flag in the ambient context here so getRunwayDb()
  // refuses to write for the whole call tree below, no matter which helper
  // ends up opening the connection.
  if (shouldApply) {
    await withBatchId(migrationBatchId, runMigration);
  } else {
    await withDryRun(true, runMigration);
  }
}

runIfDirect("runway-migrate", run);
