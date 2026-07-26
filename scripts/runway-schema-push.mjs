import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

function isTruthy(value) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Decide whether the Runway schema push should run for this build.
 *
 * The push connects to the live Runway Turso DB, so it must only fire on
 * production deploys. RUNWAY_DATABASE_URL is configured as "All Environments"
 * in Vercel — without this gate, every preview/fork build would force-push
 * schema against prod (the pre-2026-07 behavior).
 *
 * Precedence: SKIP_DB_MIGRATIONS > missing URL > RUN_DB_MIGRATIONS > VERCEL_ENV.
 */
export function shouldRunSchemaPush(env) {
  if (isTruthy(env.SKIP_DB_MIGRATIONS)) {
    return { run: false, reason: "SKIP_DB_MIGRATIONS is set" };
  }
  const runwayDatabaseUrl = env.RUNWAY_DATABASE_URL?.trim() ?? "";
  if (runwayDatabaseUrl.length === 0) {
    return { run: false, reason: "RUNWAY_DATABASE_URL is not set" };
  }
  if (isTruthy(env.RUN_DB_MIGRATIONS)) {
    return { run: true, reason: "RUN_DB_MIGRATIONS forces the push" };
  }
  if (env.VERCEL_ENV === "production") {
    return { run: true, reason: "production deploy" };
  }
  return {
    run: false,
    reason: `non-production environment (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"})`,
  };
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  const decision = shouldRunSchemaPush(process.env);

  if (!decision.run) {
    console.log(`Skipping Runway database schema push: ${decision.reason}.`);
    return;
  }

  if (!(process.env.RUNWAY_AUTH_TOKEN?.trim() ?? "")) {
    throw new Error(
      "RUNWAY_AUTH_TOKEN is required when RUNWAY_DATABASE_URL is set for deployment schema push"
    );
  }

  console.log(`Pushing Runway database schema (${decision.reason})...`);
  await run("npx", ["drizzle-kit", "push", "--config", "drizzle-runway.config.ts", "--force"]);
  await seedMetaRows();
}

/**
 * Idempotent `_meta` seed (4-level hierarchy plan §7.1 step 1). INSERT OR
 * IGNORE only — existing rows are never overwritten, so re-running on every
 * deploy is a no-op after the first. `schema_version` gates consumers that
 * must no-op until the 4-level schema is live (e.g. Slack modal helpers);
 * `feature_flags` is the staged-rollout JSON blob.
 */
async function seedMetaRows() {
  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url: process.env.RUNWAY_DATABASE_URL,
    authToken: process.env.RUNWAY_AUTH_TOKEN,
  });
  try {
    await client.execute(
      `INSERT INTO _meta (key, value, updated_at) VALUES ('schema_version', '4level-1', unixepoch())
       ON CONFLICT(key) DO NOTHING`
    );
    await client.execute(
      `INSERT INTO _meta (key, value, updated_at) VALUES ('feature_flags', '{}', unixepoch())
       ON CONFLICT(key) DO NOTHING`
    );
    console.log("Seeded _meta rows (schema_version, feature_flags) — idempotent.");
  } finally {
    client.close();
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
