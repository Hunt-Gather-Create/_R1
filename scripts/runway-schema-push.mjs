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
}

const isDirectInvocation =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
