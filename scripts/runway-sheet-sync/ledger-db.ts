/**
 * DB-backed ledger bridge (#102 / E2).
 *
 * The Phase-1a row-identity ledger (`ledger.ts`) is an in-memory `Ledger`
 * (a `Record<sheetKey, LedgerEntry>`) that Phase-1a persisted to a local JSON
 * file. On a serverless deploy that file is ephemeral, so a second sync run
 * re-derives every fuzzy match and risks duplicate creates. This module makes
 * the ledger durable by mapping it to/from the existing Turso
 * `sheet_sync_ledger` table.
 *
 * IMPORTANT: all table I/O goes through the existing repository adapter
 * `getSheetSyncLedger()` (src/lib/runway/sheet-sync-ledger-repo.ts) — this
 * bridge never issues raw drizzle queries. It only translates between the two
 * `LedgerEntry` shapes (scripts vs repo) and the two `state` enums.
 *
 * Reconciliation decisions (gated by TP on #102):
 *  - `entity_type` is always `"task"` here — Phase-1a only syncs leaf tasks.
 *    `"section"` is reserved for the L3 section work (out of scope).
 *  - `rowNumber` is NOT persisted (no column). It is ephemeral positional
 *    data that renumbers when rows move; `sheet_key` is the stable identity
 *    and `reconcileLedger` re-derives rowNumber from the current sheet every
 *    run. Loaded entries carry rowNumber = -1 until reconcile refreshes them.
 *  - Only entries WITH a `weekItemId` persist — `runway_id` is NOT NULL, and a
 *    `pending-create` entry has no durable identity to bank yet.
 */
import type {
  LedgerState,
  SheetSyncLedgerRepo,
} from "../../src/lib/runway/sheet-sync-ledger-repo";
import type { Ledger, LedgerEntry } from "./types";

/** In-memory (scripts) state -> DB lifecycle state. */
export function toDbState(state: LedgerEntry["state"]): LedgerState {
  switch (state) {
    case "matched":
      return "active";
    case "collision-flagged":
      return "flagged";
    case "orphaned":
      return "sheet-row-missing";
    case "pending-create":
      // Not persisted (no runwayId), but map to a sane default for safety.
      return "active";
  }
}

/** DB lifecycle state -> in-memory (scripts) state. */
export function fromDbState(state: LedgerState): LedgerEntry["state"] {
  switch (state) {
    case "active":
      return "matched";
    case "flagged":
      return "collision-flagged";
    case "sheet-row-missing":
    case "wi-deleted":
      return "orphaned";
    case "runway-born":
      return "pending-create";
  }
}

/**
 * Load the durable ledger for one engagement into the in-memory shape the
 * reconcile/diff pipeline expects. `taskNo` is left null and `rowNumber` -1;
 * `reconcileLedger` overwrites both from the current run's leaf tasks.
 */
export async function loadDbLedger(
  repo: SheetSyncLedgerRepo,
  engagementKey: string,
  sheetId: string
): Promise<Ledger> {
  const rows = await repo.listForEngagement(engagementKey, "task");
  const entries: Record<string, LedgerEntry> = {};
  for (const row of rows) {
    entries[row.sheetKey] = {
      key: row.sheetKey,
      taskNo: null,
      title: row.lastSeenTitle ?? "",
      rowNumber: -1,
      weekItemId: row.runwayId,
      state: fromDbState(row.state),
      lastSeenRunId: row.lastSyncRunId ?? "",
      lastSeenContentHash: row.lastSeenContentHash,
    };
  }
  return { sheetId, updatedAt: "", lastRunId: "", entries };
}

export interface SaveDbLedgerResult {
  /** Rows written (registered or touched). */
  persisted: number;
  /** Entries skipped because they have no durable weekItemId yet. */
  skipped: number;
  /** Non-fatal per-entry issues (e.g. register collisions). */
  warnings: string[];
}

/**
 * Persist the in-memory ledger for one engagement to `sheet_sync_ledger`.
 * Upsert per entry: existing sheet_key -> touch (refresh title, run id, hash,
 * state); new -> register. `pending-create` entries (no weekItemId) are
 * skipped — `runway_id` is NOT NULL and there is no durable identity to bank.
 * Collisions surface as warnings (never throw) so a partial batch still lands.
 */
export async function saveDbLedger(
  repo: SheetSyncLedgerRepo,
  engagementKey: string,
  ledger: Ledger,
  runId: string
): Promise<SaveDbLedgerResult> {
  const result: SaveDbLedgerResult = { persisted: 0, skipped: 0, warnings: [] };

  for (const e of Object.values(ledger.entries)) {
    if (e.weekItemId == null) {
      result.skipped++;
      continue;
    }
    const existing = await repo.findBySheetKey(engagementKey, "task", e.key);
    if (existing) {
      await repo.touchByRunwayId(e.weekItemId, {
        lastSeenTitle: e.title,
        lastSyncRunId: runId,
        lastSeenContentHash: e.lastSeenContentHash,
        state: toDbState(e.state),
      });
      result.persisted++;
    } else {
      const res = await repo.register({
        engagementKey,
        entityType: "task",
        sheetKey: e.key,
        runwayId: e.weekItemId,
        state: toDbState(e.state),
        lastSyncRunId: runId,
        lastSeenTitle: e.title,
        lastSeenContentHash: e.lastSeenContentHash,
      });
      if (res.ok) result.persisted++;
      else result.warnings.push(res.error);
    }
  }

  return result;
}
