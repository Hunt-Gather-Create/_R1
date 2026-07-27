import { pathToFileURL } from "node:url";

/**
 * Post-deploy schema parity check for the Runway Turso DB
 * (RW-INC-2026-07-27-01 detection gap 1).
 *
 * After `runway-schema-push.mjs` pushes schema, this verifies the live DB
 * actually has every table the shipped code queries, plus the `_meta` seed
 * rows consumers gate on. Any gap exits non-zero, which fails the Vercel
 * build and stops the deploy from aliasing forward against a DB the code
 * can't run against — exactly the failure shape of the PR #118 dashboard 500.
 *
 * EXPECTED_TABLES mirrors the `sqliteTable(...)` names in
 * `src/lib/db/runway-schema.ts`. This script stays plain Node (it runs inside
 * the build before any TS toolchain), so it can't import the schema module —
 * `scripts/runway-schema-parity-check.test.ts` asserts this list matches the
 * schema file exactly, so drift breaks tests instead of rotting silently.
 *
 * Read-only by design: every probe is `SELECT ... LIMIT 0/1`.
 * Standalone run (see docs/runway/schema-push-env-matrix.md):
 *   node scripts/runway-schema-parity-check.mjs
 */
export const EXPECTED_TABLES = [
  "_meta",
  "bot_modal_proposals",
  "clients",
  "pipeline_items",
  "projects",
  "sections",
  "sheet_registry",
  "sheet_sync_ledger",
  "team_members",
  "updates",
  "view_preferences",
  "week_items",
];

export const EXPECTED_META_KEYS = ["schema_version", "feature_flags"];

/**
 * Probe every expected table and `_meta` seed key against the given libsql
 * client. Returns { ok, missingTables, missingMetaKeys }. A probe error is
 * only treated as "table missing" when SQLite says so ("no such table");
 * anything else (auth rotation, network, quota) is rethrown as-is, so an
 * infrastructure failure never masquerades as schema drift in the build log.
 */
export async function checkSchemaParity(client) {
  const missingTables = [];
  for (const table of EXPECTED_TABLES) {
    try {
      await client.execute(`SELECT 1 FROM "${table}" LIMIT 0`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no such table/i.test(message)) {
        throw error;
      }
      missingTables.push(table);
    }
  }

  const missingMetaKeys = [];
  if (!missingTables.includes("_meta")) {
    for (const key of EXPECTED_META_KEYS) {
      const result = await client.execute({
        sql: `SELECT 1 FROM "_meta" WHERE key = ? LIMIT 1`,
        args: [key],
      });
      if (result.rows.length === 0) {
        missingMetaKeys.push(key);
      }
    }
  } else {
    // _meta itself is missing — its seed keys are unreachable, report them too.
    missingMetaKeys.push(...EXPECTED_META_KEYS);
  }

  return {
    ok: missingTables.length === 0 && missingMetaKeys.length === 0,
    missingTables,
    missingMetaKeys,
  };
}

/**
 * Turn a checkSchemaParity result into pass/fail: throws with a full gap list
 * on failure, returns the human log line on success. Split out so the
 * throw-on-gap contract is directly unit-testable.
 */
export function assertParityResult(result) {
  if (!result.ok) {
    const parts = [];
    if (result.missingTables.length > 0) {
      parts.push(`missing tables: ${result.missingTables.join(", ")}`);
    }
    if (result.missingMetaKeys.length > 0) {
      parts.push(`missing _meta keys: ${result.missingMetaKeys.join(", ")}`);
    }
    throw new Error(`Runway schema parity check FAILED — ${parts.join("; ")}`);
  }
  return `Runway schema parity check passed: ${EXPECTED_TABLES.length} tables present, _meta seeded (${EXPECTED_META_KEYS.join(", ")}).`;
}

/**
 * Build-pipeline entry point: connect using the deploy env vars (or an
 * injected client, for tests), run the check, log the verdict, and throw on
 * any gap so the caller (schema push / direct invocation) exits non-zero.
 */
export async function runSchemaParityCheck(injectedClient) {
  let client = injectedClient;
  if (!client) {
    const url = process.env.RUNWAY_DATABASE_URL?.trim() ?? "";
    if (url.length === 0) {
      throw new Error("RUNWAY_DATABASE_URL is required for the schema parity check");
    }
    const { createClient } = await import("@libsql/client");
    client = createClient({
      url,
      authToken: process.env.RUNWAY_AUTH_TOKEN,
    });
  }

  try {
    console.log(assertParityResult(await checkSchemaParity(client)));
  } finally {
    client.close();
  }
}

const isDirectInvocation =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  runSchemaParityCheck().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
