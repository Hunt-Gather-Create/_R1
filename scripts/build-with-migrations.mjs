import { spawn } from "node:child_process";

function isTruthy(value) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
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

function getPackageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) {
    return { command: "pnpm", runArgs: ["run"] };
  }
  if (userAgent.startsWith("yarn")) {
    return { command: "yarn", runArgs: [] };
  }
  return { command: "npm", runArgs: ["run"] };
}

async function main() {
  const shouldSkipMigrations = isTruthy(process.env.SKIP_DB_MIGRATIONS);
  const forceRunMigrations = isTruthy(process.env.RUN_DB_MIGRATIONS);
  const isVercelBuild = process.env.VERCEL === "1";
  const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL?.trim() ?? "";
  const shouldRunMigrations =
    !shouldSkipMigrations &&
    tursoDatabaseUrl.length > 0 &&
    (forceRunMigrations || isVercelBuild);

  const { command, runArgs } = getPackageManager();

  if (shouldRunMigrations) {
    if (!(process.env.TURSO_AUTH_TOKEN?.trim() ?? "")) {
      throw new Error(
        "TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is set for deployment migrations"
      );
    }

    console.log("Running Turso migrations before build...");
    await run(command, [...runArgs, "db:migrate"]);
  } else {
    console.log("Skipping database migrations for build.");
    if (tursoDatabaseUrl.length > 0 && !isVercelBuild && !forceRunMigrations) {
      console.log(
        "TURSO_DATABASE_URL is set, but this is not a Vercel build. Set RUN_DB_MIGRATIONS=true to force."
      );
    }
  }

  console.log("Running Next.js build...");
  await run(command, [...runArgs, "build:next"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
