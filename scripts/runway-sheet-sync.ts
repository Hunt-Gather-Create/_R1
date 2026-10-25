/**
 * Runway Sheet Sync, Phase 1a diff CLI: read a plan sheet, diff it against Runway, emit the result.
 *
 * A run without --apply, with or without --live, opens prod read-only and
 * writes nothing to any database: no sheet_sync_ledger, sheet_registry or
 * queue rows. Its handle throws on every write method. It writes only the
 * report files below to --out on local disk, plus a refusal record there
 * when a sheet refuses. Only --apply writes, to prod, or to runway-staging
 * with --target staging.
 *
 * Usage:
 *   pnpm runway:sheet-sync                       # every schedule discovery chooses
 *   pnpm runway:sheet-sync -- --job <jobNumber>  # one job's schedule, the main way to pick one
 *   pnpm runway:sheet-sync -- --sheet <sheetId>  # one sheet, resolved through discovery
 *   pnpm runway:sheet-sync -- --fixtures <dir> --out <dir>
 *   pnpm runway:sheet-sync -- --live             # service account when GOOGLE_SERVICE_ACCOUNT_JSON is set, else the google-api CLI
 *
 * Schedules come from discovery: the job ledger named by RUNWAY_JOB_LEDGER_SHEET_ID,
 * a Drive search, and the clients and sheet_registry tables. No sheet lives in code.
 *
 * Inputs:  fixture JSON exports (google-api skill) in --fixtures dir,
 *          prod via RUNWAY_DATABASE_URL (.env.local), read-only without --apply;
 *          runway-staging via RUNWAY_STAGING_DATABASE_URL only on --apply --target staging.
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
import { getSheetSyncLedger } from "../src/lib/runway/sheet-sync-ledger-repo";
import { diffSheet } from "./runway-sheet-sync/diff";
import { loadLedger, reconcileLedger, saveLedger } from "./runway-sheet-sync/ledger";
import { loadDbLedger, saveDbLedger } from "./runway-sheet-sync/ledger-db";
import { parseSheet } from "./runway-sheet-sync/parse-sheet";
import { buildPayloads } from "./runway-sheet-sync/payloads";
import { renderReport } from "./runway-sheet-sync/report";
import { readClientBundle } from "./runway-sheet-sync/runway-read";
import type { Staffing } from "./runway-sheet-sync/staffing";
import { loadStaffing } from "./runway-sheet-sync/staffing-read";
import { chooseLiveSource, liveSourceLine, readSheetLive } from "./runway-sheet-sync/sheets-client";
import type { SheetFixture } from "./runway-sheet-sync/types";
import { assertTarget } from "./runway-sheet-sync/target-guard";
import { runDatabase } from "./runway-sheet-sync/db-target";
import { readOnlyDb } from "./runway-sheet-sync/read-only-db";
import { applyPayloads } from "./runway-sheet-sync/apply";
import { writePreSnapshot, postVerifyDiff } from "./runway-sheet-sync/snapshot";
import { discoverForRun, liveDiscoveryDeps } from "./runway-sheet-sync/discover-live";
import type { ScheduleDiscovery } from "./runway-sheet-sync/schedule-discovery";
import { allSchedules, scheduleForJob, scheduleForSheet, skippedRowLines } from "./runway-sheet-sync/schedule-select";
import { checkTitleCode } from "./runway-sheet-sync/title-code-check";
import { recordingRefusal, refusingAll } from "./runway-sheet-sync/refusal-record";
import { LIVE_RANGE } from "./runway-sheet-sync/columns";

const DEFAULT_FIXTURES_DIR = "docs/tmp/data/runway-sync/fixtures";
const DEFAULT_OUT_DIR = "docs/tmp/data/runway-sync";

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

const SNAP_DIR = "docs/tmp/data-tp/snapshots";

export async function runSheet(
  db: ReturnType<typeof createRunwayDb>["db"],
  sheetId: string,
  fixturesDir: string,
  outDir: string,
  live: boolean,
  apply = false,
  force = false,
  discovery: ScheduleDiscovery,
  staffing?: Staffing
): Promise<Record<string, unknown>> {
  // Only --apply may write, so every other run gets a handle that cannot.
  const handle = apply ? db : readOnlyDb(db);
  return recordingRefusal(outDir, sheetId, async (diffWritten) =>
    syncSheet(handle, sheetId, fixturesDir, outDir, live, apply, force, discovery, staffing ?? (await loadStaffing(handle)), diffWritten)
  );
}

/** One sheet's run; calls diffWritten once the diff report is on disk. */
async function syncSheet(
  db: ReturnType<typeof createRunwayDb>["db"],
  sheetId: string,
  fixturesDir: string,
  outDir: string,
  live: boolean,
  apply: boolean,
  force: boolean,
  discovery: ScheduleDiscovery,
  staffing: Staffing,
  diffWritten: () => void
): Promise<Record<string, unknown>> {
  // Discovery already chose the newest schedule per job, so a superseded or refused sheet throws here.
  const config = scheduleForSheet(discovery, sheetId);
  const titleCodeNote = checkTitleCode(config, discovery.listing);

  let fixture: SheetFixture;
  if (live) {
    fixture = await readSheetLive(sheetId, LIVE_RANGE, chooseLiveSource());
  } else {
    const fixturePath = join(fixturesDir, `${sheetId}.json`);
    if (!existsSync(fixturePath)) {
      throw new Error(`Fixture missing at ${fixturePath} — export via google-api skill first`);
    }
    fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as SheetFixture;
  }
  const runId = computeRunId(sheetId, fixture);

  const parsed = parseSheet(fixture, { config });
  if (titleCodeNote) parsed.flags.push(titleCodeNote);

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
  const diff = diffSheet(parsed, bundle, ledger, { runId, staffing });
  const payloads = buildPayloads(diff, runId);
  // Ledger row count BEFORE this run's reconcile/link — the fact that tells
  // the report whether a zero match count is a true first run or a matcher
  // stuck at zero against rows it has seen before (_R1#152).
  const priorLedgerRowCount = Object.keys(prior.entries).length;
  const { report, error: matchedCounterError } = renderReport(diff, payloads, priorLedgerRowCount);

  const date = new Date().toISOString().slice(0, 10);
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, `diff-${sheetId}-${date}.md`);
  const payloadsPath = join(outDir, `diff-${sheetId}-${date}.payloads.json`);
  writeFileSync(reportPath, report);
  diffWritten();
  writeFileSync(
    payloadsPath,
    JSON.stringify({ sheetId, runId, generatedAt: diff.generatedAt, payloads }, null, 2) + "\n"
  );

  let ledgerSink: string;
  if (repo && !apply) {
    ledgerSink = "db:sheet_sync_ledger (not saved, dry run)";
  } else if (repo) {
    const saved = await saveDbLedger(repo, config.engagementCode, ledger, runId);
    for (const w of saved.warnings) parsed.flags.push(`LEDGER: ${w}`);
    ledgerSink = `db:sheet_sync_ledger (persisted ${saved.persisted}, skipped ${saved.skipped})`;
  } else {
    saveLedger(ledgerPath, ledger);
    ledgerSink = ledgerPath;
  }

  if (matchedCounterError) {
    throw new Error(
      `runway-sheet-sync: ${sheetId} matched 0 sheet tasks against a populated ledger ` +
        `(${priorLedgerRowCount} banked row(s)) — matcher appears broken, not a first run. See ${reportPath}`
    );
  }

  let appliedCount: number | undefined;
  let reviewCount: number | undefined;

  if (apply) {
    // Pre-snapshot MUST be written before any write attempt.
    writePreSnapshot(bundle, runId, SNAP_DIR);
    const applyResult = await applyPayloads(db, payloads, { runId, apply: true, force });
    const postBundle = await readClientBundle(db, config.clientSlug);
    postVerifyDiff(bundle, postBundle, runId, SNAP_DIR);
    // `applied` is the ledger of ATTEMPTS and deliberately records failures
    // (including the unknown-op default branch, which never ran an operation).
    // The reported count must be attempts that actually succeeded, or a run
    // that wrote nothing still reports work done.
    appliedCount = applyResult.applied.filter(
      (a) => (a.response as { ok?: boolean } | null)?.ok === true,
    ).length;
    reviewCount = applyResult.review.length;
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
    schedule: { job: config.engagementCode, fromRegistry: config.fromRegistry === true },
    ...(apply ? { applied: appliedCount, review: reviewCount } : {}),
  };
}

/** --job, then --sheet, else every chosen schedule; a refused --sheet leaves a refusal record. */
export function pickTargets(discovery: ScheduleDiscovery, outDir: string, job?: string, sheet?: string) {
  if (job) return { targets: [scheduleForJob(discovery, job)], refusals: [] };
  if (sheet) return { targets: refusingAll(outDir, [sheet], () => [scheduleForSheet(discovery, sheet)]), refusals: [] };
  return allSchedules(discovery);
}

async function main(): Promise<void> {
  const fixturesDir = arg("fixtures") ?? DEFAULT_FIXTURES_DIR;
  const outDir = arg("out") ?? DEFAULT_OUT_DIR;
  const onlySheet = arg("sheet");
  const onlyJob = arg("job");
  const live = process.argv.includes("--live");
  const doApply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
  const target = arg("target");
  const force = process.argv.includes("--force");

  // A run without --apply opens prod read-only; --apply opens prod or --target staging.
  const { staging, readOnly } = runDatabase(process.argv, target);
  const opened = createRunwayDb({ staging });
  const db = readOnly ? readOnlyDb(opened.db) : opened.db;
  const url = opened.url;
  console.error(readOnly ? "── dry run: prod, read-only, writes nothing" : `── apply target: ${staging ? "runway-staging" : "prod"}`);
  if (!url.startsWith("libsql")) {
    throw new Error(
      `${staging ? "RUNWAY_STAGING_DATABASE_URL" : "RUNWAY_DATABASE_URL"} not loaded (resolved "${url}"): check .env.local before diffing against a stale local file`
    );
  }

  // Safety gate: assertTarget throws BEFORE any write when target is missing,
  // mismatches the resolved DB host, or is prod without the allow env signal.
  if (doApply) {
    assertTarget(target, url, process.env);
  }

  if (live) console.error(liveSourceLine(chooseLiveSource()));

  const discovery = await discoverForRun(process.env, liveDiscoveryDeps(db));
  const skipped = skippedRowLines(discovery);
  if (skipped.length > 0) console.error(`── SKIPPED ${skipped.length} job ledger row(s):\n${skipped.map((l) => `   ${l}`).join("\n")}`);
  const { targets, refusals } = pickTargets(discovery, outDir, onlyJob, onlySheet);
  for (const r of refusals) console.error(`── REFUSED: ${r}`);

  // Owner and resources resolve through Runway staffing, read once for every sheet.
  const staffing = await loadStaffing(db);
  const summaries: Record<string, unknown>[] = [];
  for (const t of targets) {
    console.error(`── diffing ${t.engagementCode} ${t.label} (${t.sheetId.slice(0, 8)}…)`);
    summaries.push(await runSheet(db, t.sheetId, fixturesDir, outDir, live, doApply, force, discovery, staffing));
  }
  console.log(JSON.stringify(summaries, null, 2));
  process.exit(refusals.length > 0 ? 1 : 0);
}

runIfDirect("runway-sheet-sync", main);
