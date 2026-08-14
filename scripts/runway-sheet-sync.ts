/**
 * Runway Sheet Sync — Phase 1a diff CLI (READ + DIFF + EMIT, zero writes).
 *
 * Usage:
 *   pnpm runway:sheet-sync                       # all registered sheets
 *   pnpm runway:sheet-sync -- --sheet <sheetId>  # one sheet
 *   pnpm runway:sheet-sync -- --fixtures <dir> --out <dir>
 *   pnpm runway:sheet-sync -- --live             # read via service account (deployed path, needs GOOGLE_SERVICE_ACCOUNT_JSON)
 *
 * Inputs:  fixture JSON exports (google-api skill) in --fixtures dir,
 *          Runway prod via RUNWAY_DATABASE_URL (.env.local).
 * Outputs per sheet (in --out dir, gitignored under docs/tmp/):
 *   diff-<sheetId>-<date>.md            human-readable diff report
 *   diff-<sheetId>-<date>.payloads.json ready-to-apply operation payloads
 *   ledger-<sheetId>.json               row-identity ledger (§2.9)
 *
 * Spec: civ-account-manager/docs/runway-tp-runway-integration-pre-plan.md (v4)
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createRunwayDb, runIfDirect } from "./lib/run-script";
import { getSheetConfig, SHEETS } from "./runway-sheet-sync/config";
import { getSheetSyncLedger } from "../src/lib/runway/sheet-sync-ledger-repo";
import { diffSheet } from "./runway-sheet-sync/diff";
import { loadLedger, reconcileLedger, saveLedger } from "./runway-sheet-sync/ledger";
import { loadDbLedger, saveDbLedger } from "./runway-sheet-sync/ledger-db";
import { parseSheet } from "./runway-sheet-sync/parse-sheet";
import { buildPayloads } from "./runway-sheet-sync/payloads";
import { renderReport } from "./runway-sheet-sync/report";
import { readClientBundle } from "./runway-sheet-sync/runway-read";
import { readSheetViaServiceAccount } from "./runway-sheet-sync/sheets-client";
import type { SheetFixture } from "./runway-sheet-sync/types";

const DEFAULT_FIXTURES_DIR = "docs/tmp/data/runway-sync/fixtures";
const DEFAULT_OUT_DIR = "docs/tmp/data/runway-sync";
// Live reads use the same tab + range the fixtures were exported from.
const LIVE_RANGE = "Task Tracker & Gantt Chart!A1:N";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

export function computeRunId(sheetId: string, fixture: SheetFixture): string {
  const contentHash = createHash("sha256").update(JSON.stringify(fixture.values)).digest("hex");
  return createHash("sha256")
    .update([sheetId, contentHash, new Date().toISOString()].join("|"))
    .digest("hex")
    .slice(0, 12);
}

export async function runSheet(
  db: ReturnType<typeof createRunwayDb>["db"],
  sheetId: string,
  fixturesDir: string,
  outDir: string,
  live: boolean
): Promise<Record<string, unknown>> {
  const config = getSheetConfig(sheetId);
  if (!config) throw new Error(`Sheet ${sheetId} not in registry (scripts/runway-sheet-sync/config.ts)`);

  let fixture: SheetFixture;
  if (live) {
    fixture = await readSheetViaServiceAccount(sheetId, LIVE_RANGE);
  } else {
    const fixturePath = join(fixturesDir, `${sheetId}.json`);
    if (!existsSync(fixturePath)) {
      throw new Error(`Fixture missing at ${fixturePath} — export via google-api skill first`);
    }
    fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as SheetFixture;
  }
  const runId = computeRunId(sheetId, fixture);

  const parsed = parseSheet(fixture, config);

  // Ledger persistence: --live uses the durable DB ledger (sheet_sync_ledger,
  // via the repo) so identity survives ephemeral serverless runs; fixture runs
  // keep the local JSON file so CI needs no DB (#102). engagementCode is the
  // stable per-engagement key (sheet_registry is not populated in Phase-1a).
  const ledgerPath = join(outDir, `ledger-${sheetId}.json`);
  const repo = live ? getSheetSyncLedger(db) : null;
  const prior = repo
    ? await loadDbLedger(repo, config.engagementCode, sheetId)
    : loadLedger(ledgerPath, sheetId);
  const { ledger, renumbered, orphanedEntries } = reconcileLedger(prior, parsed.leafTasks, runId);
  for (const r of renumbered) {
    parsed.flags.push(`LEDGER: renumber reconciled ${r.from} → ${r.to} ("${r.title}")`);
  }
  for (const o of orphanedEntries) {
    parsed.flags.push(
      `LEDGER: sheet row for entry ${o.key} ("${o.title}") disappeared — WI ${o.weekItemId ?? "none"} flagged, never auto-deleted`
    );
  }

  const bundle = await readClientBundle(db, config.clientSlug);
  const diff = diffSheet(parsed, bundle, ledger, runId);
  const payloads = buildPayloads(diff, runId);
  const report = renderReport(diff, payloads);

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, `diff-${sheetId}-${date}.md`);
  const payloadsPath = join(outDir, `diff-${sheetId}-${date}.payloads.json`);
  writeFileSync(reportPath, report);
  writeFileSync(
    payloadsPath,
    JSON.stringify({ sheetId, runId, generatedAt: diff.generatedAt, payloads }, null, 2) + "\n"
  );

  let ledgerSink: string;
  if (repo) {
    const saved = await saveDbLedger(repo, config.engagementCode, ledger, runId);
    for (const w of saved.warnings) parsed.flags.push(`LEDGER: ${w}`);
    ledgerSink = `db:sheet_sync_ledger (persisted ${saved.persisted}, skipped ${saved.skipped})`;
  } else {
    saveLedger(ledgerPath, ledger);
    ledgerSink = ledgerPath;
  }

  return {
    sheetId,
    label: config.label,
    runId,
    counts: diff.counts,
    l1: diff.l1,
    flags: diff.flags.length,
    reportPath,
    payloadsPath,
    ledgerPath: ledgerSink,
  };
}

async function main(): Promise<void> {
  const fixturesDir = arg("fixtures") ?? DEFAULT_FIXTURES_DIR;
  const outDir = arg("out") ?? DEFAULT_OUT_DIR;
  const only = arg("sheet");
  const live = process.argv.includes("--live");
  // E2 (#102): point --live at the runway-staging clone, never prod.
  const staging = process.argv.includes("--staging");

  const targets = only ? SHEETS.filter((s) => s.sheetId === only) : SHEETS;
  if (targets.length === 0) throw new Error(`--sheet ${only} not in registry`);

  const { db, url } = createRunwayDb({ staging });
  if (staging) console.error("── ledger target: runway-staging (E2 test mode)");
  if (!url.startsWith("libsql")) {
    throw new Error(
      `RUNWAY_DATABASE_URL not loaded (resolved "${url}") — check .env.local before diffing against a stale local file`
    );
  }

  const summaries: Record<string, unknown>[] = [];
  for (const t of targets) {
    console.error(`── diffing ${t.label} (${t.sheetId.slice(0, 8)}…)`);
    summaries.push(await runSheet(db, t.sheetId, fixturesDir, outDir, live));
  }
  console.log(JSON.stringify(summaries, null, 2));
  process.exit(0);
}

runIfDirect("runway-sheet-sync", main);
