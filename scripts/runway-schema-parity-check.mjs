import { pathToFileURL } from "node:url";

/**
 * Post-deploy schema parity check for the Runway Turso DB
 * (RW-INC-2026-07-27-01 detection gap 1).
 *
 * After `runway-schema-push.mjs` pushes schema, this verifies the live DB
 * actually has every table the shipped code queries, the column shape of the
 * tables this incident's migration touched, and the `_meta` seed rows
 * consumers gate on. Any gap exits non-zero, which fails the Vercel build and
 * stops the deploy from aliasing forward against a DB the code can't run
 * against — exactly the failure shape of the PR #118 dashboard 500.
 *
 * Column probes exist because table-existence alone is blind to the incident's
 * other half: this incident's own DDL was two-tenths column additions
 * (week_items.section_id / task_no), and a partially-applied or column-only
 * migration would ship a green table check while the code 500s on the first
 * `SELECT section_id` (Holdout finding M1, PR #120).
 *
 * EXPECTED_TABLES / EXPECTED_COLUMNS mirror `src/lib/db/runway-schema.ts`.
 * This script stays plain Node (it runs inside the build before any TS
 * toolchain), so it can't import the schema module —
 * `scripts/runway-schema-parity-check.test.ts` asserts both structures match
 * the schema file exactly, so drift breaks tests instead of rotting silently.
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

/**
 * Column-shape coverage: the four 4-level tables plus week_items (the table
 * this incident's migration altered). Each covered table lists its FULL
 * column set and the lockstep test enforces exact equality with the schema
 * file, so adding a column to runway-schema.ts without updating this map
 * fails tests loudly. Legacy tables not listed here get table-existence
 * coverage only.
 */
export const EXPECTED_COLUMNS = {
  week_items: [
    "id",
    "project_id",
    "client_id",
    "section_id",
    "task_no",
    "day_of_week",
    "week_of",
    "date",
    "start_date",
    "end_date",
    "blocked_by",
    "title",
    "status",
    "category",
    "owner",
    "resources",
    "notes",
    "sort_order",
    "created_at",
    "updated_at",
  ],
  sections: [
    "id",
    "project_id",
    "title",
    "sort_order",
    "notes",
    "status",
    "owner",
    "resources",
    "start_date",
    "end_date",
    "created_at",
    "updated_at",
  ],
  sheet_registry: [
    "engagement_key",
    "current_sheet_id",
    "previous_sheet_id",
    "version",
    "updated_at",
  ],
  sheet_sync_ledger: [
    "id",
    "engagement_key",
    "entity_type",
    "sheet_key",
    "runway_id",
    "state",
    "last_sync_run_id",
    "last_seen_title",
    "last_seen_content_hash",
    "last_seen_at",
  ],
  _meta: ["key", "value", "updated_at"],
};

export const EXPECTED_META_KEYS = ["schema_version", "feature_flags"];

function isSchemaGapError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /no such (table|column)/i.test(message);
}

/**
 * Probe every expected table, the column shape of every covered table, and
 * the `_meta` seed keys against the given libsql client. Returns
 * { ok, missingTables, missingColumns, missingMetaKeys } where missingColumns
 * entries are "table.column". A probe error only counts as a gap when SQLite
 * says so ("no such table" / "no such column"); anything else (auth rotation,
 * network, quota) is rethrown as-is, so an infrastructure failure never
 * masquerades as schema drift in the build log.
 */
export async function checkSchemaParity(client) {
  const missingTables = [];
  for (const table of EXPECTED_TABLES) {
    try {
      await client.execute(`SELECT 1 FROM "${table}" LIMIT 0`);
    } catch (error) {
      if (!isSchemaGapError(error)) throw error;
      missingTables.push(table);
    }
  }

  const missingColumns = [];
  for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
    // A missing table already fails the build; its columns are unreachable.
    if (missingTables.includes(table)) continue;
    const columnList = columns.map((c) => `"${c}"`).join(", ");
    try {
      await client.execute(`SELECT ${columnList} FROM "${table}" LIMIT 0`);
    } catch (error) {
      if (!isSchemaGapError(error)) throw error;
      // The combined probe names only the first missing column — re-probe
      // per column so the build log lists every gap at once.
      for (const column of columns) {
        try {
          await client.execute(`SELECT "${column}" FROM "${table}" LIMIT 0`);
        } catch (columnError) {
          if (!isSchemaGapError(columnError)) throw columnError;
          missingColumns.push(`${table}.${column}`);
        }
      }
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
    ok: missingTables.length === 0 && missingColumns.length === 0 && missingMetaKeys.length === 0,
    missingTables,
    missingColumns,
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
    if (result.missingColumns.length > 0) {
      parts.push(`missing columns: ${result.missingColumns.join(", ")}`);
    }
    if (result.missingMetaKeys.length > 0) {
      parts.push(`missing _meta keys: ${result.missingMetaKeys.join(", ")}`);
    }
    throw new Error(`Runway schema parity check FAILED — ${parts.join("; ")}`);
  }
  return `Runway schema parity check passed: ${EXPECTED_TABLES.length} tables present, column shape verified for ${Object.keys(EXPECTED_COLUMNS).length} tables, _meta seeded (${EXPECTED_META_KEYS.join(", ")}).`;
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
