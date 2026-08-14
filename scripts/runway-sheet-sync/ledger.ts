/**
 * Row-identity ledger (§2.9) — persisted (sheetId, taskNo) → weekItemId.
 *
 * Sheet rows have no stable IDs. taskNo ("1.1") is the best available key
 * but renumbers when rows are inserted. Unnumbered leaves fall back to a
 * normalized-title key. Phase 1a stores the ledger on disk (gitignored);
 * Phase 1b promotes to a DB table if greenlit.
 *
 * Hazards encoded (§2.9):
 *  - renumber: taskNo changed but title survives → reconcile, keep WI link
 *  - mid-week collision: Runway WI matches (title, weekOf, client) but is
 *    not in the ledger → flag for AM, never silently adopt
 *  - sheet row deleted: ledger entry orphaned → flag, never auto-delete WI
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { sorensenDice } from "../../src/lib/runway/fuzzy-match";
import type { LeafTask, Ledger, LedgerEntry } from "./types";

export function ledgerKey(task: Pick<LeafTask, "taskNo" | "title">): string {
  return task.taskNo ?? `t:${normalizeTitle(task.title)}`;
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * sha256 of a leaf row's structural content — the sheet cols B–J that drive
 * WeekItem field updates (completed, title, dates, priority, predecessor,
 * lag, resource). Deliberately EXCLUDES positional/identity fields
 * (rowNumber, taskNo, sortOrder) and composed notes: a row whose hash is
 * unchanged since the last banked run needs no re-diff. Title is normalized
 * so whitespace-only edits don't register as content change.
 */
export function contentHash(task: LeafTask): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        task.completed,
        normalizeTitle(task.title),
        task.startDate,
        task.endDate,
        task.priority,
        task.predecessorRow,
        task.lag,
        task.resource,
      ])
    )
    .digest("hex");
}

export function loadLedger(path: string, sheetId: string): Ledger {
  if (!existsSync(path)) {
    return { sheetId, updatedAt: "", lastRunId: "", entries: {} };
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Ledger;
  if (parsed.sheetId !== sheetId) {
    throw new Error(`Ledger at ${path} belongs to sheet ${parsed.sheetId}, expected ${sheetId}`);
  }
  return parsed;
}

export function saveLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2) + "\n");
}

export interface LedgerReconcileResult {
  ledger: Ledger;
  /** taskNo → prior taskNo for entries recovered via title match after renumber. */
  renumbered: { from: string; to: string; title: string }[];
  /** Ledger entries whose sheet row disappeared this run. */
  orphanedEntries: LedgerEntry[];
}

/** Similarity floor for treating a renumbered row as the same task. */
const RENUMBER_TITLE_THRESHOLD = 0.85;

/**
 * Reconcile this run's leaf tasks against the prior ledger.
 *
 * - Existing key match → entry carried forward (row number refreshed).
 * - Key miss but a prior entry's title fuzzy-matches (≥0.85) and that prior
 *   key is unclaimed this run → treated as a renumber; WI link survives.
 * - New rows → fresh entries in "pending-create" (linkage happens in diff).
 * - Prior entries with no surviving row → orphaned (flag, never delete).
 */
export function reconcileLedger(
  prior: Ledger,
  tasks: LeafTask[],
  runId: string
): LedgerReconcileResult {
  const next: Ledger = {
    sheetId: prior.sheetId,
    updatedAt: new Date().toISOString(),
    lastRunId: runId,
    entries: {},
  };
  const renumbered: LedgerReconcileResult["renumbered"] = [];
  const claimedPriorKeys = new Set<string>();

  // Pass 1: direct key matches — but only when the title also survives.
  // A bare key match after a row insert would mislink (new "2.2" claiming
  // the old "2.2" entry that now lives at "2.3"), so dissimilar titles
  // fall through to pass 2 and leave the prior entry claimable by its
  // true renumbered row.
  const unmatched: LeafTask[] = [];
  for (const task of tasks) {
    const key = ledgerKey(task);
    const priorEntry = prior.entries[key];
    const titleSurvives =
      priorEntry !== undefined &&
      sorensenDice(normalizeTitle(task.title), normalizeTitle(priorEntry.title)) >=
        RENUMBER_TITLE_THRESHOLD;
    if (priorEntry && titleSurvives) {
      claimedPriorKeys.add(key);
      next.entries[key] = {
        ...priorEntry,
        title: task.title,
        rowNumber: task.rowNumber,
        lastSeenRunId: runId,
        lastSeenContentHash: contentHash(task),
      };
    } else {
      unmatched.push(task);
    }
  }

  // Pass 2: renumber recovery via title similarity against unclaimed entries.
  for (const task of unmatched) {
    const key = ledgerKey(task);
    let best: { priorKey: string; entry: LedgerEntry; score: number } | null = null;
    for (const [priorKey, entry] of Object.entries(prior.entries)) {
      if (claimedPriorKeys.has(priorKey)) continue;
      const score = sorensenDice(normalizeTitle(task.title), normalizeTitle(entry.title));
      if (score >= RENUMBER_TITLE_THRESHOLD && (best === null || score > best.score)) {
        best = { priorKey, entry, score };
      }
    }
    if (best) {
      claimedPriorKeys.add(best.priorKey);
      renumbered.push({ from: best.priorKey, to: key, title: task.title });
      next.entries[key] = {
        ...best.entry,
        key,
        taskNo: task.taskNo,
        title: task.title,
        rowNumber: task.rowNumber,
        lastSeenRunId: runId,
        lastSeenContentHash: contentHash(task),
      };
    } else {
      next.entries[key] = {
        key,
        taskNo: task.taskNo,
        title: task.title,
        rowNumber: task.rowNumber,
        weekItemId: null,
        state: "pending-create",
        lastSeenRunId: runId,
        lastSeenContentHash: contentHash(task),
      };
    }
  }

  const orphanedEntries = Object.entries(prior.entries)
    .filter(([k]) => !claimedPriorKeys.has(k))
    .map(([, e]) => e);

  return { ledger: next, renumbered, orphanedEntries };
}

/** Record a diff-time linkage (matched WI or collision flag) on the ledger. */
export function linkEntry(
  ledger: Ledger,
  task: LeafTask,
  weekItemId: string | null,
  state: LedgerEntry["state"]
): void {
  const key = ledgerKey(task);
  const entry = ledger.entries[key];
  if (!entry) return;
  entry.weekItemId = weekItemId;
  entry.state = state;
}
