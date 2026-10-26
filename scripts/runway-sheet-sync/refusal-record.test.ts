/**
 * Drives runSheet, the real entrypoint, so a refusal before the diff is
 * proven to leave a record coverage reads, and a clean run after it to
 * read DEPLOYED again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../../src/lib/runway/test-db";
import { clients, projects } from "../../src/lib/db/runway-schema";
import { buildCoverage } from "./coverage";
import { requireJobLedgerSheetId } from "./job-ledger";
import { recordingRefusal, refusingAll } from "./refusal-record";
import { reportStatusReader } from "./run-report-status";
import type { ScheduleDiscovery } from "./schedule-discovery";
import { driveFile, oneScheduleDiscovery } from "./schedule.test-fixtures";
import type { SheetConfig, SheetFixture } from "./types";
import { runSheet } from "../runway-sheet-sync";

vi.mock("./staffing-read", async (original) =>
  (await import("./account-teams.test-fixtures")).loaderOverSyntheticSheet(await original())
);

const WIDGET: SheetConfig = { sheetId: "syn-widget", clientSlug: "acme-widgets", engagementCode: "ACW-2603-01", label: "Widget Page" };
const GOOD_TITLE = "ACW-2603-01 | Widget Page - Project Plan v1";
const WRONG_CODE_TITLE = "ACW-2699-01 | Widget Page - Project Plan v1";

const listing = (name: string): ScheduleDiscovery => oneScheduleDiscovery(WIDGET, { name });

function writeFixture(dir: string): void {
  const values: (string | undefined)[][] = [
    ["", "CIVILIZATION"],
    [],
    ["", "Client | Project Plan"],
    [],
    ["", `${WIDGET.label}  |   ${WIDGET.engagementCode}`],
    [],
    [],
    ["", "OVERALL PROGRESS"],
    [],
    ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE"],
    ["", "FALSE", "Build", "", "1-Jun-2026", "30-Jun-2026"],
    ["", "TRUE", "   1.1 Kickoff call", "", "1-Jun-2026", "1-Jun-2026"],
  ];
  const fixture: SheetFixture = {
    sheetId: WIDGET.sheetId,
    tab: "Task Tracker & Gantt Chart",
    range: "A1:N",
    exportedAt: "2026-09-27T00:00:00Z",
    values,
  };
  writeFileSync(join(dir, `${WIDGET.sheetId}.json`), JSON.stringify(fixture));
}

function refusals(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.startsWith(`refused-${WIDGET.sheetId}-`));
}

describe("a refusal before the diff leaves a record coverage reads", () => {
  let db: TestDb;
  let dbPath: string;
  let fixturesDir: string;
  let outDir: string;

  const run = (discovery: ScheduleDiscovery) =>
    runSheet(db, WIDGET.sheetId, fixturesDir, outDir, false, false, false, discovery);
  const coverageRow = () => buildCoverage({ discovery: listing(GOOD_TITLE), readReport: reportStatusReader(outDir) }).rows[0];

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;
    const now = new Date();
    await db.insert(clients).values([
      { id: "cl-201-acw", name: "Acme Widgets", slug: "acme-widgets", createdAt: now, updatedAt: now },
    ]);
    await db.insert(projects).values([
      { id: "pj-201-widget", clientId: "cl-201-acw", name: WIDGET.label, notes: `${WIDGET.engagementCode} SOW`, createdAt: now, updatedAt: now },
    ]);
    fixturesDir = mkdtempSync(join(tmpdir(), "sheet-sync-fixtures-201-"));
    outDir = mkdtempSync(join(tmpdir(), "sheet-sync-out-201-"));
    writeFixture(fixturesDir);
  });

  afterEach(() => {
    cleanupTestDb(dbPath);
    rmSync(fixturesDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("acceptance 1: a title code stop after a clean run reads FAILED, not DEPLOYED off the older clean report", async () => {
    await run(listing(GOOD_TITLE));
    expect(coverageRow().label).toBe("DEPLOYED");

    await expect(run(listing(WRONG_CODE_TITLE))).rejects.toThrow(/title code ACW-2699-01/);
    const row = coverageRow();
    expect(row.label).toBe("FAILED");
    expect(row.detail).toMatch(/refused before the diff.*title code ACW-2699-01/);
  });

  it("acceptance 1: a superseded refusal after a clean run reads FAILED", async () => {
    await run(listing(GOOD_TITLE));
    const newer = { ...WIDGET, sheetId: "syn-widget-v2" };
    const superseded = oneScheduleDiscovery(newer, { superseded: [driveFile(WIDGET.sheetId, GOOD_TITLE)] });
    await expect(run(superseded)).rejects.toThrow(/not the latest plan/);
    expect(coverageRow().label).toBe("FAILED");
  });

  it("acceptance 1: a missing fixture after a clean run reads FAILED", async () => {
    await run(listing(GOOD_TITLE));
    rmSync(join(fixturesDir, `${WIDGET.sheetId}.json`));
    await expect(run(listing(GOOD_TITLE))).rejects.toThrow(/Fixture missing/);
    expect(coverageRow().label).toBe("FAILED");
  });

  it("acceptance 2: a clean run after a refusal reads DEPLOYED again", async () => {
    await expect(run(listing(WRONG_CODE_TITLE))).rejects.toThrow(/title code/);
    expect(coverageRow().label).toBe("FAILED");

    await run(listing(GOOD_TITLE));
    const row = coverageRow();
    expect(row.label).toBe("DEPLOYED");
    expect(refusals(outDir)).toHaveLength(1);
  });

  it("acceptance 3: the refusal record carries the sheet id, the time and the refusal message", async () => {
    const err = await run(listing(WRONG_CODE_TITLE)).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const names = refusals(outDir);
    expect(names).toHaveLength(1);
    const body = readFileSync(join(outDir, names[0]), "utf8");
    expect(body).toContain(`- Sheet: \`${WIDGET.sheetId}\``);
    expect(body).toMatch(/^- Refused at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
    expect(body).toContain(`> **ERROR: refused before the diff.** ${(err as Error).message}`);
  });

  it("a clean run leaves no refusal record", async () => {
    await run(listing(GOOD_TITLE));
    expect(refusals(outDir)).toEqual([]);
  });
});

describe("recordingRefusal and refusingAll", () => {
  let outDir: string;
  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "sheet-sync-refusal-201-"));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("writes nothing for a throw after the diff report, which already speaks for the run", async () => {
    const run = recordingRefusal(outDir, "S1", async (diffWritten) => {
      diffWritten();
      throw new Error("matcher appears broken");
    });
    await expect(run).rejects.toThrow("matcher appears broken");
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("records a refusal of the whole run for every target sheet and rethrows it", () => {
    const decide = () => refusingAll(outDir, ["S1", "S2"], () => requireJobLedgerSheetId({}));
    expect(decide).toThrow(/RUNWAY_JOB_LEDGER_SHEET_ID is not set/);
    const names = readdirSync(outDir).sort();
    expect(names.map((n) => n.slice(0, "refused-S1-".length))).toEqual(["refused-S1-", "refused-S2-"]);
    expect(reportStatusReader(outDir)("S2")).toMatchObject({ kind: "failed", reason: expect.stringMatching(/RUNWAY_JOB_LEDGER_SHEET_ID is not set/) });
  });
});
