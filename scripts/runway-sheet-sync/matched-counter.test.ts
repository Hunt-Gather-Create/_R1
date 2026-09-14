/**
 * _R1#152 — the `matched` counter must be falsifiable.
 *
 * Before this fix, report.ts printed "Expected on a first run" any time
 * `matched === 0`, whether the ledger was empty (a real first run) or
 * already held rows from a prior run (a matcher stuck at zero). Both cases
 * rendered the identical reassuring sentence, so the number carried no
 * information — a matcher that never links anything would have looked
 * exactly like a clean bootstrap on every run after the first.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "../../src/lib/runway/test-db";
import { clients, projects, weekItems } from "../../src/lib/db/runway-schema";
import { diffSheet } from "./diff";
import { renderReport } from "./report";
import { buildPayloads } from "./payloads";
import { loadLedger } from "./ledger";
import { getSheetConfig, SHEETS } from "./config";
import { runSheet } from "../runway-sheet-sync";
import type { RunwayClientBundle } from "./runway-read";
import type { LeafTask, Ledger, ParsedSheet, SheetConfig, SheetFixture } from "./types";

// ── Unit level: renderReport must read the ledger's row count, not just
// the current run's match count (report.ts:43 before the fix). ──

const UNIT_CONFIG: SheetConfig = {
  sheetId: "synthetic-sheet-id",
  clientSlug: "acme",
  engagementCode: "ACM-2601-01",
  label: "Widget Refresh",
};

function leaf(over: Partial<LeafTask>): LeafTask {
  return {
    rowNumber: 12,
    taskNo: "1.1",
    rawLabel: "   1.1 Kickoff call",
    title: "Kickoff call",
    resolvedTitle: "Kickoff call",
    startDate: "2026-06-01",
    endDate: "2026-06-01",
    weekOf: "2026-06-01",
    completed: false,
    derivedStatus: "scheduled",
    category: "kickoff",
    section: null,
    priority: null,
    predecessorRow: null,
    lag: null,
    resource: null,
    notes: "[Sheet 1.1]",
    notesTruncated: false,
    sortOrder: 0,
    ...over,
  };
}

function parsedWith(tasks: LeafTask[]): ParsedSheet {
  return {
    config: UNIT_CONFIG,
    meta: {
      bannerVariant: "A",
      engagementTitle: "Widget Refresh",
      bannerCode: "ACM-2601-01",
      codeDrift: false,
      headerRowNumber: 10,
    },
    rows: [],
    leafTasks: tasks,
    flags: [],
  };
}

function emptyLedger(): Ledger {
  return { sheetId: UNIT_CONFIG.sheetId, updatedAt: "", lastRunId: "", entries: {} };
}

/** No Runway WIs at all — every leaf task lands "missing", matched stays 0. */
const NO_MATCH_BUNDLE: RunwayClientBundle = {
  client: { id: "cl_1", slug: "acme", name: "Acme" },
  projects: [{ id: "p_widget", name: "Widget Refresh", status: null, category: null, notes: "ACM-2601-01 SOW" }],
  weekItems: [],
};

describe("renderReport — situation-aware zero-match note (#152)", () => {
  const tasks = [leaf({})];
  const diff = diffSheet(parsedWith(tasks), NO_MATCH_BUNDLE, emptyLedger(), "run-1");
  const payloads = buildPayloads(diff, "run-1");

  it("true first run (empty ledger): prints the first-run note, no error", () => {
    const { report, error } = renderReport(diff, payloads, 0);
    expect(report).toContain("Expected on a first run");
    expect(report).not.toContain("ERROR: ledger populated");
    expect(error).toBe(false);
  });

  it("populated ledger, still zero matches: prints the error line, not the first-run note", () => {
    const { report, error } = renderReport(diff, payloads, 3);
    expect(report).toContain("ERROR: ledger populated, nothing matched");
    expect(report).toContain("3 row(s)");
    expect(report).not.toContain("Expected on a first run");
    expect(error).toBe(true);
  });
});

// ── Integration level: run the real CLI pipeline twice against one frozen
// fixture snapshot. This is the falsifiable check the ticket asks for — an
// assertion the two runs agree, not a printed number a person has to read. ──

const CONFIG = getSheetConfig(SHEETS[0].sheetId)!; // beyond-petro / BPC-2603-01

function frozenFixture(taskTitles: [string, string]): SheetFixture {
  const values: (string | undefined)[][] = [
    ["", "CIVILIZATION"], // 1
    [], // 2
    ["", "Beyond Petro | Project Plan"], // 3
    [], // 4
    ["", `${CONFIG.label}  |   ${CONFIG.engagementCode}`], // 5
    [], [], ["", "OVERALL PROGRESS"], [], // 6-9
    ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE"], // 10 header
    ["", "FALSE", "Landing Page Build", "", "1-Jun-2026", "30-Jun-2026"], // 11 rollup
    ["", "TRUE", `   1.1 ${taskTitles[0]}`, "", "1-Jun-2026", "1-Jun-2026"], // 12
    ["", "FALSE", `   1.2 ${taskTitles[1]}`, "", "8-Jun-2026", "9-Jun-2026"], // 13
  ];
  return {
    sheetId: CONFIG.sheetId,
    tab: "Task Tracker & Gantt Chart",
    range: "A1:N",
    exportedAt: "2026-09-14T00:00:00Z",
    values,
  };
}

describe("runSheet twice against one frozen snapshot (#152)", () => {
  let db: TestDb;
  let dbPath: string;
  let fixturesDir: string;
  let outDir: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;

    await db.insert(clients).values({
      id: "cl-bp-152",
      name: "Beyond Petro",
      slug: "beyond-petro",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(projects).values({
      id: "pj-bp-152",
      clientId: "cl-bp-152",
      name: CONFIG.label,
      notes: `${CONFIG.engagementCode} SOW`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    fixturesDir = mkdtempSync(join(tmpdir(), "sheet-sync-fixtures-152-"));
    outDir = mkdtempSync(join(tmpdir(), "sheet-sync-out-152-"));
  });

  afterEach(() => {
    cleanupTestDb(dbPath);
    rmSync(fixturesDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("second run reports matched == N, where N is the number of rows the first run banked", async () => {
    // WI titles/dates/status mirror the sheet exactly so the fuzzy match on
    // run 1 lands with zero field deltas (disposition "matched", not
    // "mismatched-field") — matched must come out non-zero or this proves
    // nothing (a matched==0 vs matched==0 comparison is vacuous).
    await db.insert(weekItems).values([
      {
        id: "wi-152-kick",
        projectId: "pj-bp-152",
        clientId: "cl-bp-152",
        title: "Kickoff call",
        weekOf: "2026-06-01",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        status: "completed",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "wi-152-design",
        projectId: "pj-bp-152",
        clientId: "cl-bp-152",
        title: "Design review",
        weekOf: "2026-06-08",
        startDate: "2026-06-08",
        endDate: "2026-06-09",
        status: "scheduled",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const fixture = frozenFixture(["Kickoff call", "Design review"]);
    writeFileSync(join(fixturesDir, `${CONFIG.sheetId}.json`), JSON.stringify(fixture));

    const summary1 = (await runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false)) as {
      counts: { matched: number };
    };

    // N is read off the ledger the first run actually wrote to disk, not
    // assumed — the assertion below is only meaningful if this is > 0.
    const ledgerAfterRun1 = loadLedger(join(outDir, `ledger-${CONFIG.sheetId}.json`), CONFIG.sheetId);
    const bankedN = Object.values(ledgerAfterRun1.entries).filter((e) => e.weekItemId !== null).length;
    expect(bankedN).toBeGreaterThan(0);
    expect(summary1.counts.matched).toBe(bankedN);

    const summary2 = (await runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false)) as {
      counts: { matched: number };
    };
    expect(summary2.counts.matched).toBe(bankedN);
  });

  it("a matcher stuck at zero on a populated ledger REDS instead of reporting 0 again", async () => {
    // No WIs seeded at all — every leaf task is genuinely unmatchable, so
    // both runs see matched === 0. Run 1 is a true first run (empty
    // ledger) and must succeed. Run 2 sees the ledger run 1 wrote (now
    // populated) and must refuse instead of repeating the first-run note.
    const fixture = frozenFixture(["Nothing like prod A", "Nothing like prod B"]);
    writeFileSync(join(fixturesDir, `${CONFIG.sheetId}.json`), JSON.stringify(fixture));

    const summary1 = (await runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false)) as {
      counts: { matched: number };
    };
    expect(summary1.counts.matched).toBe(0);

    const ledgerAfterRun1 = loadLedger(join(outDir, `ledger-${CONFIG.sheetId}.json`), CONFIG.sheetId);
    expect(Object.keys(ledgerAfterRun1.entries).length).toBeGreaterThan(0);

    await expect(runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false)).rejects.toThrow(
      /matched 0 sheet tasks against a populated ledger/
    );
  });
});
