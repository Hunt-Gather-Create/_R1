/**
 * Proves schedule discovery is wired into runSheet's own call site and the
 * CLI's target picking, not just correct as a unit. schedule-discovery.test.ts
 * proves the rules; this drives runSheet, the real entrypoint every CLI
 * invocation goes through, with an injected synthetic discovery.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../src/lib/runway/test-db";
import { clients, projects } from "../src/lib/db/runway-schema";
import { discoverSchedules } from "./runway-sheet-sync/schedule-discovery";
import { driveFile, ledgerJob, oneScheduleDiscovery, SYN_CLIENTS } from "./runway-sheet-sync/schedule.test-fixtures";
import type { SheetConfig, SheetFixture } from "./runway-sheet-sync/types";
import { pickTargets, runSheet } from "./runway-sheet-sync";

vi.mock("./runway-sheet-sync/staffing-read", async (original) =>
  (await import("./runway-sheet-sync/account-teams.test-fixtures")).loaderOverSyntheticSheet(await original())
);

const CONFIG: SheetConfig = { sheetId: "syn-widget", clientSlug: "acme-widgets", engagementCode: "ACW-2603-01", label: "Widget Page" };
const NEWER: SheetConfig = { ...CONFIG, sheetId: "syn-widget-v2" };
const OLD_FILE = driveFile(CONFIG.sheetId, "ACW-2603-01 | Widget Page - Project Plan v1");

describe("pickTargets, the CLI's --job and --sheet resolution", () => {
  const discovery = discoverSchedules({
    jobs: [
      ledgerJob("ABC-2604", "Acme Widgets", "Base Work"),
      ledgerJob("ABC-2604-02", "Acme Widgets", "Phase Two"),
      ledgerJob("GLX-2605", "Initech", "Unmapped"),
    ],
    listing: [
      driveFile("syn-base", "ABC-2604 Schedule v1"),
      driveFile("syn-p2", "ABC-2604-02 | Phase Two Schedule v1"),
      driveFile("syn-unmapped", "GLX-2605 Schedule v1"),
    ],
    clients: SYN_CLIENTS,
    overrides: [],
  });
  let outDir: string;
  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "sheet-sync-targets-"));
  });
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("--job ABC-2604-02 picks its synthetic schedule, with no registry entry in code", () => {
    expect(pickTargets(discovery, outDir, "ABC-2604-02")).toEqual({
      targets: [{ sheetId: "syn-p2", clientSlug: "acme-widgets", engagementCode: "ABC-2604-02", label: "Phase Two" }],
      refusals: [],
    });
  });

  it("--sheet resolves its id through discovery", () => {
    expect(pickTargets(discovery, outDir, undefined, "syn-base").targets.map((t) => t.engagementCode)).toEqual(["ABC-2604"]);
  });

  it("a refused --sheet throws and leaves a refusal record for that sheet", () => {
    expect(() => pickTargets(discovery, outDir, undefined, "syn-unmapped")).toThrow(/GLX-2605.*"Initech"/);
    expect(readdirSync(outDir).filter((n) => n.startsWith("refused-syn-unmapped-"))).toHaveLength(1);
  });

  it("with neither flag, every chosen schedule runs and each refused job is named", () => {
    const { targets, refusals } = pickTargets(discovery, outDir);
    expect(targets.map((t) => t.sheetId)).toEqual(["syn-base", "syn-p2"]);
    expect(refusals).toEqual([expect.stringMatching(/^Job GLX-2605: client "Initech"/)]);
  });
});

describe("runSheet's own call site takes the discovery", () => {
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
      id: "cl-215-discovery",
      name: "Acme Widgets",
      slug: "acme-widgets",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(projects).values({
      id: "pj-215-discovery",
      clientId: "cl-215-discovery",
      name: CONFIG.label,
      notes: `${CONFIG.engagementCode} SOW`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    fixturesDir = mkdtempSync(join(tmpdir(), "sheet-sync-fixtures-215-"));
    outDir = mkdtempSync(join(tmpdir(), "sheet-sync-out-215-"));

    const values: (string | undefined)[][] = [
      ["", "CIVILIZATION"],
      [],
      ["", "Acme Widgets | Project Plan"],
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

  it("a superseded sheet throws before reading the sheet fixture, naming the chosen schedule", async () => {
    rmSync(join(fixturesDir, `${CONFIG.sheetId}.json`));
    const discovery = oneScheduleDiscovery(NEWER, { superseded: [OLD_FILE] });
    await expect(runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false, false, false, discovery)).rejects.toThrow(
      /not the latest plan for job ACW-2603-01.*syn-widget-v2/,
    );
  });

  it("a sheet discovery never found throws before reading the sheet fixture", async () => {
    const discovery = oneScheduleDiscovery(NEWER);
    await expect(runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false, false, false, discovery)).rejects.toThrow(
      /not found by schedule discovery/,
    );
  });

  it("runs to completion on the chosen sheet and names its job in the summary", async () => {
    const summary = (await runSheet(db, CONFIG.sheetId, fixturesDir, outDir, false, false, false, oneScheduleDiscovery(CONFIG))) as {
      counts: { "leaf-tasks": number };
      schedule: { job: string; fromRegistry: boolean };
    };
    expect(summary.counts["leaf-tasks"]).toBe(1);
    expect(summary.schedule).toEqual({ job: "ACW-2603-01", fromRegistry: false });
  });
});
