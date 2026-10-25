/**
 * A run without --apply reads the database and writes nothing to it, with or
 * without --live. An --apply run still saves the ledger and applies through
 * applyPayloads. The database is a synthetic sqlite file behind a spy that
 * counts every write method touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "../../src/lib/runway/test-db";
import { clients, projects, sheetSyncLedger, weekItems } from "../../src/lib/db/runway-schema";
import { getSheetSyncLedger } from "../../src/lib/runway/sheet-sync-ledger-repo";
import { runSheet } from "../runway-sheet-sync";
import { applyPayloads } from "./apply";
import { WRITE_METHODS } from "./read-only-db";
import { oneScheduleDiscovery } from "./schedule.test-fixtures";
import type { SheetConfig, SheetFixture } from "./types";

const CONFIG: SheetConfig = { sheetId: "syn-dry-run", clientSlug: "acme-widgets", engagementCode: "ACW-2603-01", label: "Widget Page" };

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
vi.mock("./apply", () => ({ applyPayloads: vi.fn(async () => ({ applied: [], review: [] })) }));
vi.mock("./snapshot", () => ({ writePreSnapshot: vi.fn(), postVerifyDiff: vi.fn() }));

/** Wraps the test db so every touch of a write method is recorded, then passed through. */
function countingDb(db: TestDb): { db: TestDb; writes: string[] } {
  const writes: string[] = [];
  const blocked = new Set<string | symbol>(WRITE_METHODS);
  const spy = new Proxy(db, {
    get(target, prop, receiver) {
      if (blocked.has(prop)) writes.push(String(prop));
      return Reflect.get(target, prop, receiver);
    },
  });
  return { db: spy, writes };
}

describe("a dry run writes nothing to its database", () => {
  let db: TestDb;
  let dbPath: string;
  let fixturesDir: string;
  let outDir: string;

  async function bankedRunId(): Promise<string | null> {
    const rows = await db.select().from(sheetSyncLedger).where(eq(sheetSyncLedger.engagementKey, CONFIG.engagementCode));
    expect(rows).toHaveLength(1);
    return rows[0].lastSyncRunId;
  }

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;
    const now = new Date();
    await db.insert(clients).values({ id: "cl-dry", name: "Acme Widgets", slug: "acme-widgets", createdAt: now, updatedAt: now });
    await db.insert(projects).values({
      id: "pj-dry",
      clientId: "cl-dry",
      name: CONFIG.label,
      notes: `${CONFIG.engagementCode} SOW`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(weekItems).values({
      id: "wi-dry-kick",
      projectId: "pj-dry",
      clientId: "cl-dry",
      title: "Kickoff call",
      weekOf: "2026-06-01",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    // A banked ledger row, so a live run that saves its ledger has a row to touch.
    const banked = await getSheetSyncLedger(db).register({
      engagementKey: CONFIG.engagementCode,
      entityType: "task",
      sheetKey: "1.1",
      runwayId: "wi-dry-kick",
      state: "active",
      lastSyncRunId: "run-before",
      lastSeenTitle: "Kickoff call",
      lastSeenContentHash: null,
    });
    expect(banked.ok).toBe(true);

    fixturesDir = mkdtempSync(join(tmpdir(), "sheet-sync-dry-fixtures-"));
    outDir = mkdtempSync(join(tmpdir(), "sheet-sync-dry-out-"));
    writeFileSync(join(fixturesDir, `${CONFIG.sheetId}.json`), JSON.stringify(FIXTURE));
    vi.mocked(applyPayloads).mockClear();
  });

  afterEach(() => {
    cleanupTestDb(dbPath);
    rmSync(fixturesDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it.each([
    ["without --live", false],
    ["with --live", true],
  ])("%s, a dry run makes zero write calls and leaves the ledger row as it was", async (_label, live) => {
    const spied = countingDb(db);
    const summary = (await runSheet(spied.db, CONFIG.sheetId, fixturesDir, outDir, live, false, false, oneScheduleDiscovery(CONFIG))) as {
      reportPath: string;
      counts: { matched: number };
    };
    expect(spied.writes).toEqual([]);
    expect(await bankedRunId()).toBe("run-before");
    expect(applyPayloads).not.toHaveBeenCalled();
    // The run still did its work: it read the database and wrote its report to local disk.
    expect(summary.counts.matched).toBe(1);
    expect(existsSync(summary.reportPath)).toBe(true);
  });

  it("--apply with --live still saves the ledger and applies through applyPayloads", async () => {
    const spied = countingDb(db);
    const summary = (await runSheet(spied.db, CONFIG.sheetId, fixturesDir, outDir, true, true, false, oneScheduleDiscovery(CONFIG))) as {
      runId: string;
    };
    expect(spied.writes).toContain("update");
    expect(await bankedRunId()).toBe(summary.runId);
    expect(applyPayloads).toHaveBeenCalledWith(spied.db, expect.any(Array), expect.objectContaining({ apply: true }));
  });
});
