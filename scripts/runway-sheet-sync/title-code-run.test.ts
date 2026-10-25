/**
 * _R1#195, operator ruling C: drives runSheet, the real entrypoint, so the
 * title code check is proven at its call site and not only as a unit.
 * A title code that disagrees with the registry stops the run; banner drift
 * is still reported and tolerated; a written exception lets Soundly run.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../../src/lib/runway/test-db";
import { clients, projects } from "../../src/lib/db/runway-schema";
import { getSheetConfig } from "./config";
import type { DriveFile } from "./freshness";
import type { SheetConfig, SheetFixture } from "./types";
import { runSheet } from "../runway-sheet-sync";

const ITEP = getSheetConfig("1e0VtdHSGG-LMpQqeZ9Bm709fPSYGjrIBOi2sNFKObog")!;
const SOUNDLY = getSheetConfig("1iK2uiKLvaxezqfW43DdMihQAwmOgV0Z8gNh7uCcbvrM")!;

const FROZEN = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "drive-listing-2026-09-27.json"), "utf8"),
) as { files: DriveFile[] };

function listingWith(config: SheetConfig, name: string): DriveFile[] {
  return [{ id: config.sheetId, name, modifiedTime: "2026-09-17T17:53:33.403Z" }];
}

function checked(listing: DriveFile[]) {
  return { checked: true as const, listing, listingPath: "listing.json", listingAgeDays: 0 };
}

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
      { id: "cl-195-bp", name: "Beyond Petro", slug: "beyond-petro", createdAt: now, updatedAt: now },
      { id: "cl-195-snd", name: "Soundly", slug: "soundly", createdAt: now, updatedAt: now },
    ]);
    await db.insert(projects).values([
      { id: "pj-195-itep", clientId: "cl-195-bp", name: ITEP.label, notes: `${ITEP.engagementCode} SOW`, createdAt: now, updatedAt: now },
      { id: "pj-195-snd", clientId: "cl-195-snd", name: SOUNDLY.label, notes: `${SOUNDLY.engagementCode} SOW`, createdAt: now, updatedAt: now },
    ]);
    fixturesDir = mkdtempSync(join(tmpdir(), "sheet-sync-fixtures-195-"));
    outDir = mkdtempSync(join(tmpdir(), "sheet-sync-out-195-"));
  });

  afterEach(() => {
    cleanupTestDb(dbPath);
    rmSync(fixturesDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("acceptance 1: a title code that disagrees with the registry stops the run, naming the sheet and both codes", async () => {
    writeFixture(fixturesDir, ITEP, ITEP.engagementCode);
    const run = runSheet(
      db, ITEP.sheetId, fixturesDir, outDir, false, false, false,
      checked(listingWith(ITEP, "BPC-2699-01 | ITEP Landing Page - Project Plan v1")),
    );
    await expect(run).rejects.toThrow(
      new RegExp(`${ITEP.sheetId}.*title code BPC-2699-01.*registry code BPC-2603-01.*acceptedTitleCodes`),
    );
  });

  it("acceptance 2: title and registry agree with a drifted banner, so the run proceeds and reports the banner note", async () => {
    writeFixture(fixturesDir, ITEP, "BPC-2603-02");
    const summary = (await runSheet(
      db, ITEP.sheetId, fixturesDir, outDir, false, false, false,
      checked(listingWith(ITEP, "BPC-2603-01 | ITEP Landing Page - Project Plan v1")),
    )) as { counts: { "leaf-tasks": number }; reportPath: string };
    expect(summary.counts["leaf-tasks"]).toBe(1);
    const report = readFileSync(summary.reportPath, "utf8");
    expect(report).toMatch(/CODE-DRIFT \(R7\): banner code BPC-2603-02 != config engagement code BPC-2603-01/);
    expect(report).not.toMatch(/TITLE CODE/);
  });

  it("acceptance 3: the Soundly sheet, titled SND-2602 in the frozen listing, runs because of its written exception", async () => {
    const frozenSoundly = FROZEN.files.filter((f) => f.id === SOUNDLY.sheetId);
    expect(frozenSoundly.map((f) => f.name)).toEqual(["SND-2602 | RX Card Rebuild | Project Plan v1"]);
    writeFixture(fixturesDir, SOUNDLY, SOUNDLY.engagementCode);
    const summary = (await runSheet(
      db, SOUNDLY.sheetId, fixturesDir, outDir, false, false, false, checked(frozenSoundly),
    )) as { counts: { "leaf-tasks": number }; reportPath: string };
    expect(summary.counts["leaf-tasks"]).toBe(1);
    expect(readFileSync(summary.reportPath, "utf8")).toMatch(
      /TITLE CODE: title code SND-2602 != registry code SND-2603, accepted by a known exception/,
    );
  });

  it("acceptance 3: the same Soundly sheet with any other title code still stops", async () => {
    writeFixture(fixturesDir, SOUNDLY, SOUNDLY.engagementCode);
    const run = runSheet(
      db, SOUNDLY.sheetId, fixturesDir, outDir, false, false, false,
      checked(listingWith(SOUNDLY, "SND-2601 | RX Card Rebuild | Project Plan v1")),
    );
    await expect(run).rejects.toThrow(/title code SND-2601.*registry code SND-2603/);
  });
});
