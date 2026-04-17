/**
 * Runway Pull — Snapshot DB state to JSON
 *
 * Usage:
 *   pnpm runway:pull                  # Snapshot to data/runway-snapshot.json
 *   pnpm runway:pull --diff           # Show changes since last snapshot
 *   pnpm runway:pull --table clients  # Snapshot single table
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { createRunwayDb, runIfDirect } from "./lib/run-script";
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
  updates,
  teamMembers,
} from "../src/lib/db/runway-schema";

// ── Types ──────────────────────────────────────────────────

type TableName = "clients" | "projects" | "weekItems" | "pipelineItems" | "updates" | "teamMembers";

type Row = Record<string, unknown>;
type TableData = Record<TableName, Row[]>;

export interface Snapshot {
  pulledAt: string;
  source: string;
  tables: TableData;
}

interface FieldChange {
  from: unknown;
  to: unknown;
}

interface RowDiff {
  id: string;
  fields: Record<string, FieldChange>;
}

interface TableDiff {
  added: Row[];
  removed: Row[];
  changed: RowDiff[];
}

type SnapshotDiff = Record<TableName, TableDiff>;

// ── Core functions (exported for testing) ──────────────────

const ALL_TABLE_NAMES: TableName[] = ["clients", "projects", "weekItems", "pipelineItems", "updates", "teamMembers"];

export function buildSnapshot(tables: TableData, source: string): Snapshot {
  return {
    pulledAt: new Date().toISOString(),
    source,
    tables,
  };
}

/** Validate that a snapshot has all 6 required tables. Throws if incomplete. */
export function validateSnapshot(snapshot: Snapshot): void {
  for (const name of ALL_TABLE_NAMES) {
    if (!(name in snapshot.tables)) {
      throw new Error(`Snapshot incomplete: missing table "${name}"`);
    }
  }
}

export function diffSnapshots(older: Snapshot, newer: Snapshot): SnapshotDiff {
  const tableNames = ALL_TABLE_NAMES;
  const result = {} as SnapshotDiff;

  for (const table of tableNames) {
    const oldRows = older.tables[table] ?? [];
    const newRows = newer.tables[table] ?? [];

    const oldById = new Map(oldRows.map((r) => [r.id as string, r]));
    const newById = new Map(newRows.map((r) => [r.id as string, r]));

    const added = newRows.filter((r) => !oldById.has(r.id as string));
    const removed = oldRows.filter((r) => !newById.has(r.id as string));

    const changed: RowDiff[] = [];
    for (const [id, newRow] of newById) {
      const oldRow = oldById.get(id);
      if (!oldRow) continue;

      const fields: Record<string, FieldChange> = {};
      const allKeys = new Set([...Object.keys(oldRow), ...Object.keys(newRow)]);
      for (const key of allKeys) {
        const oldVal = oldRow[key];
        const newVal = newRow[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          fields[key] = { from: oldVal, to: newVal };
        }
      }
      if (Object.keys(fields).length > 0) {
        changed.push({ id, fields });
      }
    }

    result[table] = { added, removed, changed };
  }

  return result;
}

function formatDiff(diff: SnapshotDiff): string {
  const lines: string[] = [];
  const tableNames = ALL_TABLE_NAMES;

  for (const table of tableNames) {
    const d = diff[table];
    const hasChanges = d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0;
    if (!hasChanges) continue;

    lines.push(`\n## ${table}`);
    for (const row of d.added) {
      lines.push(`  + Added: ${(row.name ?? row.title ?? row.id) as string}`);
    }
    for (const row of d.removed) {
      lines.push(`  - Removed: ${(row.name ?? row.title ?? row.id) as string}`);
    }
    for (const change of d.changed) {
      lines.push(`  ~ Changed ${change.id}:`);
      for (const [field, { from, to }] of Object.entries(change.fields)) {
        lines.push(`    ${field}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
      }
    }
  }

  if (lines.length === 0) {
    return "No changes detected.";
  }
  return lines.join("\n");
}

// ── CLI ────────────────────────────────────────────────────

const SNAPSHOT_PATH = resolve(process.cwd(), "data/runway-snapshot.json");

const TABLE_MAP = { clients, projects, weekItems, pipelineItems, updates, teamMembers } as const;

async function pull() {
  const args = process.argv.slice(2);
  const isDiff = args.includes("--diff");
  const tableIdx = args.indexOf("--table");
  const singleTable = tableIdx !== -1 ? args[tableIdx + 1] as TableName : null;

  let db, url: string;
  try {
    ({ db, url } = createRunwayDb());
  } catch (err) {
    console.error("Failed to connect to database:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log(`Pulling from: ${url}`);

  const tableNames = singleTable ? [singleTable] : (Object.keys(TABLE_MAP) as TableName[]);
  const tables = {} as TableData;

  for (const name of tableNames) {
    const table = TABLE_MAP[name];
    if (!table) {
      console.error(`Unknown table: ${name}`);
      process.exit(1);
    }
    try {
      const rows = await db.select().from(table);
      tables[name] = rows;
      console.log(`  ${name}: ${rows.length} rows`);
    } catch (err) {
      console.error(`Failed to pull table ${name}:`, err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }

  // Fill missing tables for single-table mode
  if (singleTable) {
    for (const name of Object.keys(TABLE_MAP) as TableName[]) {
      if (!tables[name]) tables[name] = [];
    }
  }

  // Validate all 6 tables are present before writing
  const snapshot = buildSnapshot(tables, url);
  try {
    validateSnapshot(snapshot);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (isDiff) {
    if (!existsSync(SNAPSHOT_PATH)) {
      console.error("No previous snapshot found. Run without --diff first.");
      process.exit(1);
    }
    const previous = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8")) as Snapshot;
    const diff = diffSnapshots(previous, snapshot);
    console.log(formatDiff(diff));
  }

  // Write snapshot
  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  console.log(`\nSnapshot written to: ${SNAPSHOT_PATH}`);
}

runIfDirect("runway-pull", pull);
