/**
 * Runway Sheet Sync, Parity Harness CLI, _R1#151.
 *
 * Two frozen snapshots in, one verdict file out.
 *
 * Usage:
 *   # 1. Freeze prod, read-only, writes nothing back:
 *   npx tsx scripts/runway-sheet-sync/parity/cli.ts --capture-prod \
 *     --client <clientSlug> --out <prodSnapshotPath>
 *
 *   # 2. Freeze the sheet via the google-api skill export step, the existing
 *   #    SheetFixture format, same as scripts/runway-sheet-sync.ts.
 *
 *   # 3. Compare the two frozen files:
 *   npx tsx scripts/runway-sheet-sync/parity/cli.ts \
 *     --sheet-fixture <path> --prod-snapshot <path> \
 *     --engagement-code <code> --label <label> --out <verdictPath>
 *
 * Re-running step 3 on the same two files produces a byte-identical verdict
 * file. Nothing here reads a live sheet or a live DB.
 */
import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { createRunwayDb, runIfDirect } from "../../lib/run-script";
import { parseSheet } from "../parse-sheet";
import { renderParityReport } from "../report";
import type { SheetConfig, SheetFixture } from "../types";
import { computeParity } from "./compare";
import { captureProdSnapshot, writeProdSnapshot } from "./prod-snapshot";
import type { ParityResult, ProdSnapshot } from "./types";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

/** Hash of the two frozen files' raw bytes, no wall clock, so re-running on
 * the same two files always yields the same runId, per the ticket's
 * "byte-identical" requirement. */
export function computeParityRunId(sheetFixtureRaw: string, prodSnapshotRaw: string): string {
  return createHash("sha256").update(sheetFixtureRaw).update("|").update(prodSnapshotRaw).digest("hex").slice(0, 16);
}

export function writeParityResult(result: ParityResult, outPath: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
}

export interface RunParityOptions {
  sheetFixturePath: string;
  prodSnapshotPath: string;
  engagementCode: string;
  label: string;
  outPath: string;
}

/**
 * The one command: two frozen files in, one verdict file plus a markdown
 * reader's aid next to it, out. Exported directly so tests exercise the
 * real call site, not a re-implementation of it.
 */
export function runParity(opts: RunParityOptions): ParityResult {
  if (!opts.outPath.endsWith(".json")) {
    // The markdown reader's aid is derived by replacing the .json suffix.
    // Without this guard, an --out path with no .json suffix makes that
    // derivation a no-op and the markdown write silently clobbers the
    // verdict file it was supposed to sit next to.
    throw new Error(`--out must end in .json, got "${opts.outPath}"`);
  }
  const sheetFixtureRaw = readFileSync(opts.sheetFixturePath, "utf8");
  const prodSnapshotRaw = readFileSync(opts.prodSnapshotPath, "utf8");
  const fixture = JSON.parse(sheetFixtureRaw) as SheetFixture;
  const prodSnapshot = JSON.parse(prodSnapshotRaw) as ProdSnapshot;

  const config: SheetConfig = {
    sheetId: fixture.sheetId,
    clientSlug: prodSnapshot.clientSlug,
    engagementCode: opts.engagementCode,
    label: opts.label,
  };
  // Wall-clock measured around the actual compute, per sheet, for the
  // report's cost line. Never fed into computeParityRunId or writeParityResult
  // below — those stay bytes-of-the-two-frozen-files only, so a re-run on
  // the same inputs still produces a byte-identical verdict file.
  const wallClockStart = Date.now();
  const parsed = parseSheet(fixture, config);
  const runId = computeParityRunId(sheetFixtureRaw, prodSnapshotRaw);
  const result = computeParity(parsed, prodSnapshot, runId, fixture.exportedAt);
  const wallClockMs = Date.now() - wallClockStart;

  writeParityResult(result, opts.outPath);
  writeFileSync(
    opts.outPath.replace(/\.json$/, ".md"),
    // tokens is hardcoded 0: nothing in the sync pipeline calls a model
    // today (_R1#156, model-free.test.ts enforces it stays that way). Once
    // a model exists somewhere in the path, this becomes a real count.
    renderParityReport(result, { wallClockMs, tokens: 0 })
  );

  return result;
}

async function main(): Promise<void> {
  if (process.argv.includes("--capture-prod")) {
    const clientSlug = arg("client");
    const outPath = arg("out");
    if (!clientSlug || !outPath) {
      throw new Error("--capture-prod requires --client <slug> and --out <path>");
    }
    const { db, url } = createRunwayDb();
    if (!url.startsWith("libsql")) {
      throw new Error(`RUNWAY_DATABASE_URL not loaded, resolved "${url}". Check .env.local`);
    }
    console.error(`capturing prod snapshot for ${clientSlug}, read-only`);
    const snapshot = await captureProdSnapshot(db, clientSlug);
    writeProdSnapshot(snapshot, outPath);
    console.log(JSON.stringify({ clientSlug, capturedAt: snapshot.capturedAt, weekItems: snapshot.weekItems.length, outPath }, null, 2));
    process.exit(0);
  }

  const sheetFixturePath = arg("sheet-fixture");
  const prodSnapshotPath = arg("prod-snapshot");
  const engagementCode = arg("engagement-code");
  const label = arg("label");
  const outPath = arg("out");
  if (!sheetFixturePath || !prodSnapshotPath || !engagementCode || !label || !outPath) {
    throw new Error(
      "Usage: --sheet-fixture <path> --prod-snapshot <path> --engagement-code <code> --label <label> --out <path>"
    );
  }

  const result = runParity({ sheetFixturePath, prodSnapshotPath, engagementCode, label, outPath });
  console.log(JSON.stringify({ runId: result.runId, counts: result.counts, interventions: result.interventions, outPath }, null, 2));
  process.exit(0);
}

runIfDirect("cli", main);
