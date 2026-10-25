/**
 * A dry run through runSheet hands every database reader the read-only
 * handle, even when the caller passes the raw one. Each reader is spied, so
 * the handle it received is the one checked. Scratch file database only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../../src/lib/runway/test-db";
import { clients, projects } from "../../src/lib/db/runway-schema";
import { getSheetSyncLedger } from "../../src/lib/runway/sheet-sync-ledger-repo";
import { runSheet } from "../runway-sheet-sync";
import { readClientBundle } from "./runway-read";
import { loadStaffing } from "./staffing-read";
import { oneScheduleDiscovery } from "./schedule.test-fixtures";
import type { SheetConfig, SheetFixture } from "./types";

const CONFIG: SheetConfig = { sheetId: "syn-handle", clientSlug: "acme-widgets", engagementCode: "ACW-2603-01", label: "Widget Page" };

const FIXTURE: SheetFixture = {
  sheetId: CONFIG.sheetId,
  tab: "Task Tracker & Gantt Chart",
  range: "A1:N",
  exportedAt: "2026-10-01T00:00:00Z",
  values: [
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
  ],
};

vi.mock("./sheets-client", async (original) => ({
  ...(await original<typeof import("./sheets-client")>()),
  chooseLiveSource: () => ({ kind: "cli" }),
  readSheetLive: vi.fn(async () => FIXTURE),
}));
vi.mock("./runway-read", async (original) => {
  const real = await original<typeof import("./runway-read")>();
  return { ...real, readClientBundle: vi.fn(real.readClientBundle) };
});
vi.mock("./staffing-read", async (original) => {
  const real = await original<typeof import("./staffing-read")>();
  return { ...real, loadStaffing: vi.fn(real.loadStaffing) };
});
vi.mock("../../src/lib/runway/sheet-sync-ledger-repo", async (original) => {
  const real = await original<typeof import("../../src/lib/runway/sheet-sync-ledger-repo")>();
  return { ...real, getSheetSyncLedger: vi.fn(real.getSheetSyncLedger) };
});

describe("a dry run wraps the handle it gives every reader", () => {
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
    await db.insert(clients).values({ id: "cl-handle", name: "Acme Widgets", slug: "acme-widgets", createdAt: now, updatedAt: now });
    await db.insert(projects).values({
      id: "pj-handle",
      clientId: "cl-handle",
      name: CONFIG.label,
      notes: `${CONFIG.engagementCode} SOW`,
      createdAt: now,
      updatedAt: now,
    });
    fixturesDir = mkdtempSync(join(tmpdir(), "sheet-sync-handle-fixtures-"));
    outDir = mkdtempSync(join(tmpdir(), "sheet-sync-handle-out-"));
    writeFileSync(join(fixturesDir, `${CONFIG.sheetId}.json`), JSON.stringify(FIXTURE));
    vi.mocked(readClientBundle).mockClear();
    vi.mocked(loadStaffing).mockClear();
    vi.mocked(getSheetSyncLedger).mockClear();
  });

  afterEach(() => {
    cleanupTestDb(dbPath);
    rmSync(fixturesDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("given the raw handle, a live dry run hands each reader a handle on which an insert throws", async () => {
    await runSheet(db, CONFIG.sheetId, fixturesDir, outDir, true, false, false, oneScheduleDiscovery(CONFIG));

    const handles = [
      ...vi.mocked(loadStaffing).mock.calls.map((c) => c[0]),
      ...vi.mocked(readClientBundle).mock.calls.map((c) => c[0]),
      ...vi.mocked(getSheetSyncLedger).mock.calls.map((c) => c[0]),
    ];
    expect(vi.mocked(loadStaffing)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readClientBundle)).toHaveBeenCalled();
    expect(vi.mocked(getSheetSyncLedger)).toHaveBeenCalled();
    const now = new Date();
    for (const h of handles) {
      expect(() => h!.insert(clients).values({ id: "cl-new", name: "Globex", slug: "globex", createdAt: now, updatedAt: now })).toThrow(
        /read-only database.*only --apply writes/,
      );
    }
    expect((await db.select({ id: clients.id }).from(clients)).map((r) => r.id)).not.toContain("cl-new");
  });
});
