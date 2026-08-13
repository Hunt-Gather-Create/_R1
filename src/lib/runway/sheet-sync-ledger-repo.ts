/**
 * Sheet Sync Ledger — repository adapter (v4-schema-plan §4.6 + §9.4)
 *
 * All persistence of sheet-sync record-keeping goes through this repository
 * interface, never through direct Turso calls in business logic. The v1
 * backend is the Runway Turso `sheet_sync_ledger` table; the planned v2
 * backend is the Memory Substrate via MCP. Swapping backends is a change to
 * this file only — consumers depend on `SheetSyncLedgerRepo`.
 *
 * The ledger maps stable in-sheet identity (engagementKey + entityType +
 * sheetKey) to Runway entities (week item or section ids). `engagementKey`
 * is stable across sheet versions (see `sheet_registry`); raw spreadsheet
 * ids are never used as ledger keys.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { sheetSyncLedger } from "@/lib/db/runway-schema";
import { and, eq } from "drizzle-orm";
import { generateId } from "./operations-utils";

export const LEDGER_ENTITY_TYPES = ["task", "section"] as const;
export type LedgerEntityType = (typeof LEDGER_ENTITY_TYPES)[number];

/**
 * Ledger row lifecycle states (v4-schema-plan §4.6):
 * - `active`            — normal reconciled state
 * - `sheet-row-missing` — ledger entry exists but sheet no longer has this row
 * - `wi-deleted`        — Runway entity was deleted, ledger orphaned
 * - `flagged`           — reconciliation ambiguity, needs operator input
 * - `runway-born`       — minted via Runway auto-append, not yet reconciled
 */
export const LEDGER_STATES = [
  "active",
  "sheet-row-missing",
  "wi-deleted",
  "flagged",
  "runway-born",
] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

export interface LedgerEntry {
  id: string;
  engagementKey: string;
  entityType: LedgerEntityType;
  sheetKey: string;
  runwayId: string;
  state: LedgerState;
  lastSyncRunId: string | null;
  lastSeenTitle: string | null;
  lastSeenContentHash: string | null;
  lastSeenAt: Date;
}

export interface RegisterLedgerEntryParams {
  engagementKey: string;
  entityType: LedgerEntityType;
  sheetKey: string;
  runwayId: string;
  state?: LedgerState;
  lastSyncRunId?: string | null;
  lastSeenTitle?: string | null;
  lastSeenContentHash?: string | null;
}

export type LedgerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Minimal executor shape so callers inside `db.transaction(tx => ...)` can
 * pass the transaction and keep ledger writes atomic with entity writes.
 */
type LedgerExecutor = Pick<
  ReturnType<typeof getRunwayDb>,
  "select" | "insert" | "update"
>;

export interface SheetSyncLedgerRepo {
  /**
   * Register a new ledger row. Fails (ok: false) on a sheetKey collision for
   * the engagement — the caller routes collisions to the digest rather than
   * silently duplicating (v4-schema-plan §4.3 / R11).
   */
  register(params: RegisterLedgerEntryParams): Promise<LedgerResult<LedgerEntry>>;
  /** Reverse lookup by Runway entity id (UNIQUE per schema). */
  findByRunwayId(runwayId: string): Promise<LedgerEntry | null>;
  /** Forward lookup by stable sheet identity. */
  findBySheetKey(
    engagementKey: string,
    entityType: LedgerEntityType,
    sheetKey: string,
  ): Promise<LedgerEntry | null>;
  /** All rows for an engagement, optionally narrowed by entity type. */
  listForEngagement(
    engagementKey: string,
    entityType?: LedgerEntityType,
  ): Promise<LedgerEntry[]>;
  /** Flip a row's lifecycle state by Runway entity id. No-op if absent. */
  markStateByRunwayId(runwayId: string, state: LedgerState): Promise<void>;
  /**
   * Refresh last-seen provenance after a reconcile pass. No-op if absent.
   * `lastSeenContentHash` and `state` are optional (E2, #102): a reconcile
   * that re-banks an existing row updates its change-detection hash and
   * lifecycle state in place, without a second call. Omitted fields are left
   * untouched.
   */
  touchByRunwayId(
    runwayId: string,
    seen: {
      lastSeenTitle?: string | null;
      lastSyncRunId?: string | null;
      lastSeenContentHash?: string | null;
      state?: LedgerState;
    },
  ): Promise<void>;
}

function rowToEntry(row: typeof sheetSyncLedger.$inferSelect): LedgerEntry {
  return {
    id: row.id,
    engagementKey: row.engagementKey,
    entityType: row.entityType as LedgerEntityType,
    sheetKey: row.sheetKey,
    runwayId: row.runwayId,
    state: row.state as LedgerState,
    lastSyncRunId: row.lastSyncRunId,
    lastSeenTitle: row.lastSeenTitle,
    lastSeenContentHash: row.lastSeenContentHash,
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * v1 backend: Runway Turso. Pass a transaction object to keep ledger writes
 * in the same atomic boundary as the entity mutation they describe.
 */
export function getSheetSyncLedger(executor?: LedgerExecutor): SheetSyncLedgerRepo {
  const db = executor ?? getRunwayDb();

  return {
    async register(params) {
      const existing = await db
        .select()
        .from(sheetSyncLedger)
        .where(
          and(
            eq(sheetSyncLedger.engagementKey, params.engagementKey),
            eq(sheetSyncLedger.entityType, params.entityType),
            eq(sheetSyncLedger.sheetKey, params.sheetKey),
          ),
        )
        .limit(1);
      if (existing[0]) {
        return {
          ok: false,
          error: `Ledger collision: ${params.entityType} '${params.sheetKey}' already registered for engagement '${params.engagementKey}' (runwayId ${existing[0].runwayId}, state ${existing[0].state}).`,
        };
      }
      const entry: LedgerEntry = {
        id: generateId(),
        engagementKey: params.engagementKey,
        entityType: params.entityType,
        sheetKey: params.sheetKey,
        runwayId: params.runwayId,
        state: params.state ?? "active",
        lastSyncRunId: params.lastSyncRunId ?? null,
        lastSeenTitle: params.lastSeenTitle ?? null,
        lastSeenContentHash: params.lastSeenContentHash ?? null,
        lastSeenAt: new Date(),
      };
      try {
        await db.insert(sheetSyncLedger).values(entry);
      } catch (e) {
        // The pre-check above is advisory only — a concurrent register can
        // land between the SELECT and this INSERT. The UNIQUE indexes are
        // the real guard; surface the constraint hit as a normal collision
        // so callers take their fallback path instead of aborting a
        // wrapping transaction.
        const message = e instanceof Error ? e.message : String(e);
        if (/UNIQUE|constraint/i.test(message)) {
          return {
            ok: false,
            error: `Ledger collision (concurrent register): ${params.entityType} '${params.sheetKey}' for engagement '${params.engagementKey}'.`,
          };
        }
        throw e;
      }
      return { ok: true, data: entry };
    },

    async findByRunwayId(runwayId) {
      const rows = await db
        .select()
        .from(sheetSyncLedger)
        .where(eq(sheetSyncLedger.runwayId, runwayId))
        .limit(1);
      return rows[0] ? rowToEntry(rows[0]) : null;
    },

    async findBySheetKey(engagementKey, entityType, sheetKey) {
      const rows = await db
        .select()
        .from(sheetSyncLedger)
        .where(
          and(
            eq(sheetSyncLedger.engagementKey, engagementKey),
            eq(sheetSyncLedger.entityType, entityType),
            eq(sheetSyncLedger.sheetKey, sheetKey),
          ),
        )
        .limit(1);
      return rows[0] ? rowToEntry(rows[0]) : null;
    },

    async listForEngagement(engagementKey, entityType) {
      const where = entityType
        ? and(
            eq(sheetSyncLedger.engagementKey, engagementKey),
            eq(sheetSyncLedger.entityType, entityType),
          )
        : eq(sheetSyncLedger.engagementKey, engagementKey);
      const rows = await db.select().from(sheetSyncLedger).where(where);
      return rows.map(rowToEntry);
    },

    async markStateByRunwayId(runwayId, state) {
      await db
        .update(sheetSyncLedger)
        .set({ state, lastSeenAt: new Date() })
        .where(eq(sheetSyncLedger.runwayId, runwayId));
    },

    async touchByRunwayId(runwayId, seen) {
      await db
        .update(sheetSyncLedger)
        .set({
          ...(seen.lastSeenTitle !== undefined ? { lastSeenTitle: seen.lastSeenTitle } : {}),
          ...(seen.lastSyncRunId !== undefined ? { lastSyncRunId: seen.lastSyncRunId } : {}),
          ...(seen.lastSeenContentHash !== undefined
            ? { lastSeenContentHash: seen.lastSeenContentHash }
            : {}),
          ...(seen.state !== undefined ? { state: seen.state } : {}),
          lastSeenAt: new Date(),
        })
        .where(eq(sheetSyncLedger.runwayId, runwayId));
    },
  };
}
