/**
 * _R1#195, operator ruling C: drives runSheet, the real entrypoint, so the
 * title code check is proven at its call site and not only as a unit.
 * A title code that disagrees with the job number stops the run; banner
 * drift is still reported and tolerated; a sheet_registry row lets an old
 * title run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../../src/lib/runway/test-db";
import { clients, projects } from "../../src/lib/db/runway-schema";
import { oneScheduleDiscovery } from "./schedule.test-fixtures";
import type { SheetConfig, SheetFixture } from "./types";
import { runSheet } from "../runway-sheet-sync";

vi.mock("./staffing-read", async (original) =>
  (await import("./account-teams.test-fixtures")).loaderOverSyntheticSheet(await original())
);

const WIDGET: SheetConfig = { sheetId: "syn-widget", clientSlug: "acme-widgets", engagementCode: "ACW-2603-01", label: "Widget Page" };
const PINNED: SheetConfig = {
  sheetId: "syn-pinned",
  clientSlug: "globex",
  engagementCode: "GLX-2603",
  label: "Pinned Rebuild",
  fromRegistry: true,
};

const discoveryWith = (config: SheetConfig, name: string) => oneScheduleDiscovery(config, { name });

function writeFixture(dir: string, config: SheetConfig, bannerCode: string): void {
  const values: (string | undefined)[][] = [
    ["", "CIVILIZATION"],
    [],
    ["", "Client | Project Plan"],
    [],
    ["", `${config.label}  |   ${bannerCode}`],
    [],
    [],
    ["", "OVERALL PROGRESS"],
    [],
    ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE"],
    ["", "FALSE", "Build", "", "1-Jun-2026", "30-Jun-2026"],
    ["", "TRUE", "   1.1 Kickoff call", "", "1-Jun-2026", "1-Jun-2026"],
  ];
  const fixture: SheetFixture = {
    sheetId: config.sheetId,
    tab: "Task Tracker & Gantt Chart",
    range: "A1:N",
    exportedAt: "2026-09-27T00:00:00Z",
    values,
  };
  writeFileSync(join(dir, `${config.sheetId}.json`), JSON.stringify(fixture));
}

describe("_R1#195, the title code check at runSheet's own call site", () => {
  let db: TestDb;
  let dbPath: string;
  let fixturesDir: string;
  let outDir: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;
    const now = new Date();
    await db.insert(clients).values([
      { id: "cl-195-acw", name: "Acme Widgets", slug: "acme-widgets", createdAt: now, updatedAt: now },
      { id: "cl-195-glx", name: "Globex", slug: "globex", createdAt: now, updatedAt: now },
    ]);
    await db.insert(projects).values([
      { id: "pj-195-widget", clientId: "cl-195-acw", name: WIDGET.label, notes: `${WIDGET.engagementCode} SOW`, createdAt: now, updatedAt: now },
      { id: "pj-195-pinned", clientId: "cl-195-glx", name: PINNED.label, notes: `${PINNED.engagementCode} SOW`, createdAt: now, updatedAt: now },
    ]);
    fixturesDir = mkdtempSync(join(tmpdir(), "sheet-sync-fixtures-195-"));
    outDir = mkdtempSync(join(tmpdir(), "sheet-sync-out-195-"));
  });

  afterEach(() => {
    cleanupTestDb(dbPath);
    rmSync(fixturesDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("acceptance 1: a title code that disagrees with the job number stops the run, naming the sheet and both codes", async () => {
    writeFixture(fixturesDir, WIDGET, WIDGET.engagementCode);
    const run = runSheet(
      db, WIDGET.sheetId, fixturesDir, outDir, false, false, false,
      discoveryWith(WIDGET, "ACW-2699-01 | Widget Page - Project Plan v1"),
    );
    await expect(run).rejects.toThrow(
      new RegExp(`${WIDGET.sheetId}.*title code ACW-2699-01.*job number ACW-2603-01.*sheet_registry`),
    );
  });

  it("acceptance 2: title and job number agree with a drifted banner, so the run proceeds and reports the banner note", async () => {
    writeFixture(fixturesDir, WIDGET, "ACW-2603-02");
    const summary = (await runSheet(
      db, WIDGET.sheetId, fixturesDir, outDir, false, false, false,
      discoveryWith(WIDGET, "ACW-2603-01 | Widget Page - Project Plan v1"),
    )) as { counts: { "leaf-tasks": number }; reportPath: string };
    expect(summary.counts["leaf-tasks"]).toBe(1);
    const report = readFileSync(summary.reportPath, "utf8");
    expect(report).toMatch(/CODE-DRIFT \(R7\): banner code ACW-2603-02 != config engagement code ACW-2603-01/);
    expect(report).not.toMatch(/TITLE CODE/);
  });

  it("acceptance 3, rule 5: a sheet a sheet_registry row chose runs under its old title code", async () => {
    writeFixture(fixturesDir, PINNED, PINNED.engagementCode);
    const summary = (await runSheet(
      db, PINNED.sheetId, fixturesDir, outDir, false, false, false,
      discoveryWith(PINNED, "GLX-2602 | Pinned Rebuild | Project Plan v1"),
    )) as { counts: { "leaf-tasks": number }; reportPath: string };
    expect(summary.counts["leaf-tasks"]).toBe(1);
    expect(readFileSync(summary.reportPath, "utf8")).toMatch(
      /TITLE CODE: title code GLX-2602 != job number GLX-2603, accepted because a sheet_registry row names this sheet/,
    );
  });

  it("acceptance 3: the same title with no registry row still stops", async () => {
    const unpinned = { ...PINNED, fromRegistry: undefined };
    writeFixture(fixturesDir, unpinned, unpinned.engagementCode);
    const run = runSheet(
      db, unpinned.sheetId, fixturesDir, outDir, false, false, false,
      discoveryWith(unpinned, "GLX-2602 | Pinned Rebuild | Project Plan v1"),
    );
    await expect(run).rejects.toThrow(/title code GLX-2602.*job number GLX-2603/);
  });
});
