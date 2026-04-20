/**
 * Runway Migrate — Run migration scripts against the Runway DB
 *
 * Usage:
 *   pnpm runway:migrate scripts/runway-migrations/001-example.ts           # Dry-run (default)
 *   pnpm runway:migrate scripts/runway-migrations/001-example.ts --apply   # Apply changes
 *   pnpm runway:migrate scripts/runway-migrations/001-example.ts --apply --target prod  # Prod (requires confirmation)
 *   pnpm runway:migrate scripts/runway-migrations/001-example.ts --apply --target prod --yes  # Skip confirmation
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { resolve, basename, extname } from "path";
import { createInterface } from "readline";
import { runIfDirect } from "./lib/run-script";
import { setBatchId } from "@/lib/runway/operations-utils";

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

  // Run migration
  const ctx = createMigrationContext(db, !shouldApply);

  if (shouldApply) {
    setBatchId(migrationBatchId);
  }

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
  } finally {
    setBatchId(null);
  }
}

runIfDirect("runway-migrate", run);
