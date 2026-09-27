/**
 * _R1#154 item 2: proves the freshness DECISION is wired into runSheet's
 * own call site and the CLI's flag resolution, not just correct as a
 * standalone unit. freshness.test.ts already proves checkFreshness itself;
 * this drives runSheet, the real entrypoint every CLI invocation goes
 * through, and resolveFreshnessDecision, the real flag-parsing path.
 *
 * TP's gate-1 ruling on the first version of this file, before it merged:
 * an optional runSheet parameter that defaulted to skipping is off in
 * practice, the exact defect this ticket exists for. The decision is now
 * required at both the CLI and runSheet's own signature, so a caller
 * cannot skip by omission, and a skip is always loud.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../src/lib/runway/test-db";
import { clients, projects } from "../src/lib/db/runway-schema";
import { getSheetConfig, SHEETS } from "./runway-sheet-sync/config";
import {
  freshnessDecisionForAge,
  resolveFreshnessDecision,
  SKIP_REASON_FLAG,
  type DriveFile,
} from "./runway-sheet-sync/freshness";
import type { SheetFixture } from "./runway-sheet-sync/types";
import { runSheet } from "./runway-sheet-sync";

const CONFIG = getSheetConfig(SHEETS[0].sheetId)!; // beyond-petro / BPC-2603-01 / ITEP

const STALE_LISTING: DriveFile[] = [
  { id: CONFIG.sheetId, name: "BPC-2603-01 | ITEP Landing Page - Project Plan v1", modifiedTime: "2026-09-17T17:53:33.403Z" },
  { id: "1cS5yxsnNlXiMX84CwAUBpyEueEph__RmIrf9OTUmtgM", name: "BPC-2604_itep_Project-Plan-v2", modifiedTime: "2026-08-27T04:01:14.936Z" },
];
const FRESH_LISTING: DriveFile[] = [
  { id: CONFIG.sheetId, name: "BPC-2603-01 | ITEP Landing Page - Project Plan v1", modifiedTime: "2026-09-17T17:53:33.403Z" },
];

describe("resolveFreshnessDecision and freshnessDecisionForAge, the CLI's own flag resolution (_R1#154, TP's gate-1 ruling)", () => {
  it("acceptance a, RED on the prior tip: neither flag given refuses, naming both flags and #161", () => {
    expect(() => resolveFreshnessDecision({ listingPath: undefined, skip: false })).toThrow(
      /--drive-listing.*--skip-freshness-check.*#161/,
    );
  });

  it("--skip-freshness-check alone resolves to a skipped decision carrying the flag as its reason", () => {
    const decision = resolveFreshnessDecision({ listingPath: undefined, skip: true });
    expect(decision).toEqual({ checked: false, reason: SKIP_REASON_FLAG });
  });

  it("acceptance c: a listing older than 7 days refuses, naming the age, when skip is not also given", () => {
    expect(() =>
      freshnessDecisionForAge({ listingPath: "/tmp/x.json", listing: [], ageDays: 8, skip: false }),
    ).toThrow(/8\.0 days old.*7-day/);
  });

  it("a listing exactly at 7 days does not refuse", () => {
    const decision = freshnessDecisionForAge({ listingPath: "/tmp/x.json", listing: [], ageDays: 7, skip: false });
    expect(decision.checked).toBe(true);
  });

  it("a stale listing combined with --skip-freshness-check does not refuse: skip overrides the age check", () => {
    const decision = freshnessDecisionForAge({ listingPath: "/tmp/x.json", listing: [], ageDays: 30, skip: true });
    expect(decision).toEqual({ checked: false, reason: SKIP_REASON_FLAG });
  });
});

describe("_R1#154 item 2, runSheet's own call site", () => {
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
      id: "cl-154-freshness",
      name: "Beyond Petro",
      slug: "beyond-petro",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(projects).values({
      id: "pj-154-freshness",
      clientId: "cl-154-freshness",
      name: CONFIG.label,
      notes: `${CONFIG.engagementCode} SOW`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    fixturesDir = mkdtempSync(join(tmpdir(), "sheet-sync-fixtures-154-"));
    outDir = mkdtempSync(join(tmpdir(), "sheet-sync-out-154-"));

    const values: (string | undefined)[][] = [
      ["", "CIVILIZATION"],
      [],
      ["", "Beyond Petro | Project Plan"],
      [],
      ["", `${CONFIG.label}  |   ${CONFIG.engagementCode}`],
      [],
      [],
      ["", "OVERALL PROGRESS"],
      [],
      ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE"],
      ["", "FALSE", "Landing Page Build", "", "1-Jun-2026", "30-Jun-2026"],
      ["", "TRUE", "   1.1 Kickoff call", "", "1-Jun-2026", "1-Jun-2026"],
    ];
    const fixture: SheetFixture = {
      sheetId: CONFIG.sheetId,
      tab: "Task Tracker & Gantt Chart",
      range: "A1:N",
      exportedAt: "2026-09-27T00:00:00Z",
      values,
    };
    writeFileSync(join(fixturesDir, `${CONFIG.sheetId}.json`), JSON.stringify(fixture));
  });

  afterEach(() => {
    cleanupTestDb(dbPath);
    rmSync(fixturesDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("acceptance d: throws before reading the sheet fixture when the decision is a checked, stale listing, naming the sibling", async () => {
    await expect(
      runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false, false, false, {
        checked: true,
        listing: STALE_LISTING,
        listingPath: "stale-listing.json",
        listingAgeDays: 0,
      }),
    ).rejects.toThrow(/BPC-2604_itep_Project-Plan-v2/);
  });

  it("acceptance d: runs to completion when the decision is a checked, fresh listing", async () => {
    const summary = (await runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false, false, false, {
      checked: true,
      listing: FRESH_LISTING,
      listingPath: "fresh-listing.json",
      listingAgeDays: 0,
    })) as { counts: { "leaf-tasks": number } };
    expect(summary.counts["leaf-tasks"]).toBe(1);
  });

  it("acceptance b: a skipped decision runs to completion, and both the printed summary and the written report carry the NOT CHECKED line", async () => {
    const summary = (await runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false, false, false, {
      checked: false,
      reason: SKIP_REASON_FLAG,
    })) as { counts: { "leaf-tasks": number }; reportPath: string; freshness: { checked: false; note: string } };

    expect(summary.counts["leaf-tasks"]).toBe(1);
    expect(summary.freshness.checked).toBe(false);
    expect(summary.freshness.note).toMatch(/FRESHNESS NOT CHECKED/);
    expect(summary.freshness.note).toMatch(new RegExp(SKIP_REASON_FLAG.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&")));

    const reportText = readFileSync(summary.reportPath, "utf8");
    expect(reportText).toMatch(/FRESHNESS NOT CHECKED/);
  });
});
