import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "../../src/lib/runway/test-db";
import { getSheetSyncLedger } from "../../src/lib/runway/sheet-sync-ledger-repo";
import { sheetSyncLedger } from "../../src/lib/db/runway-schema";
import { loadDbLedger, saveDbLedger } from "./ledger-db";
import type { Ledger, LedgerEntry } from "./types";

const ENG = "SND-01";

function entry(over: Partial<LedgerEntry>): LedgerEntry {
  return {
    key: "1.1",
    taskNo: "1.1",
    title: "Kickoff",
    rowNumber: 12,
    weekItemId: "wi_kick",
    state: "matched",
    lastSeenRunId: "run-1",
    lastSeenContentHash: "hash-a",
    ...over,
  };
}

function ledgerOf(entries: LedgerEntry[]): Ledger {
  return {
    sheetId: "sheet-x",
    updatedAt: "",
    lastRunId: "run-1",
    entries: Object.fromEntries(entries.map((e) => [e.key, e])),
  };
}

describe("loadDbLedger (repo rows -> in-memory Ledger)", () => {
  let db: TestDb;
  let dbPath: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;
  });
  afterEach(() => cleanupTestDb(dbPath));

  it("returns an empty ledger for an engagement with no rows", async () => {
    const repo = getSheetSyncLedger(db);
    const ledger = await loadDbLedger(repo, ENG, "sheet-x");
    expect(ledger.sheetId).toBe("sheet-x");
    expect(Object.keys(ledger.entries)).toHaveLength(0);
  });

  it("maps rows keyed by sheetKey with state + hash carried, rowNumber sentinel", async () => {
    const repo = getSheetSyncLedger(db);
    await repo.register({
      engagementKey: ENG,
      entityType: "task",
      sheetKey: "1.1",
      runwayId: "wi_kick",
      state: "active",
      lastSyncRunId: "run-1",
      lastSeenTitle: "Kickoff",
      lastSeenContentHash: "hash-a",
    });
    await repo.register({
      engagementKey: ENG,
      entityType: "task",
      sheetKey: "t:buffer",
      runwayId: "wi_buf",
      state: "flagged",
      lastSeenTitle: "Buffer",
      lastSeenContentHash: "hash-b",
    });

    const ledger = await loadDbLedger(repo, ENG, "sheet-x");
    expect(Object.keys(ledger.entries).sort()).toEqual(["1.1", "t:buffer"]);

    const kick = ledger.entries["1.1"];
    expect(kick.key).toBe("1.1");
    expect(kick.weekItemId).toBe("wi_kick");
    expect(kick.state).toBe("matched"); // active -> matched
    expect(kick.title).toBe("Kickoff");
    expect(kick.lastSeenContentHash).toBe("hash-a");
    expect(kick.lastSeenRunId).toBe("run-1");
    expect(kick.rowNumber).toBe(-1); // ephemeral; reconcile refreshes

    expect(ledger.entries["t:buffer"].state).toBe("collision-flagged"); // flagged -> collision-flagged
  });

  it("only loads rows for the requested engagement", async () => {
    const repo = getSheetSyncLedger(db);
    await repo.register({ engagementKey: ENG, entityType: "task", sheetKey: "1.1", runwayId: "wi_a" });
    await repo.register({ engagementKey: "OTHER", entityType: "task", sheetKey: "1.1", runwayId: "wi_b" });
    const ledger = await loadDbLedger(repo, ENG, "sheet-x");
    expect(Object.keys(ledger.entries)).toEqual(["1.1"]);
    expect(ledger.entries["1.1"].weekItemId).toBe("wi_a");
  });
});

describe("saveDbLedger (in-memory Ledger -> repo upsert)", () => {
  let db: TestDb;
  let dbPath: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client);
    db = t.db;
    dbPath = t.dbPath;
  });
  afterEach(() => cleanupTestDb(dbPath));

  it("persists only entries with a weekItemId (pending-create skipped)", async () => {
    const repo = getSheetSyncLedger(db);
    const ledger = ledgerOf([
      entry({ key: "1.1", weekItemId: "wi_kick", state: "matched" }),
      entry({ key: "2.1", weekItemId: null, state: "pending-create" }),
    ]);
    const res = await saveDbLedger(repo, ENG, ledger, "run-1");
    expect(res.persisted).toBe(1);
    expect(res.skipped).toBe(1);

    const rows = await repo.listForEngagement(ENG, "task");
    expect(rows).toHaveLength(1);
    expect(rows[0].sheetKey).toBe("1.1");
    expect(rows[0].state).toBe("active"); // matched -> active
    expect(rows[0].lastSeenContentHash).toBe("hash-a");
  });

  it("updates in place on re-save (no duplicate row, hash refreshed)", async () => {
    const repo = getSheetSyncLedger(db);
    await saveDbLedger(repo, ENG, ledgerOf([entry({})]), "run-1");
    // Same key + weekItemId, changed title + hash.
    await saveDbLedger(
      repo,
      ENG,
      ledgerOf([entry({ title: "Kickoff v2", lastSeenContentHash: "hash-b" })]),
      "run-2"
    );

    const rows = await repo.listForEngagement(ENG, "task");
    expect(rows).toHaveLength(1); // updated, not duplicated
    expect(rows[0].lastSeenTitle).toBe("Kickoff v2");
    expect(rows[0].lastSeenContentHash).toBe("hash-b");
    expect(rows[0].lastSyncRunId).toBe("run-2");
  });

  it("re-derives and re-banks after the engagement's rows are deleted (non-vacuity)", async () => {
    const repo = getSheetSyncLedger(db);
    await saveDbLedger(repo, ENG, ledgerOf([entry({})]), "run-1");
    expect(await repo.listForEngagement(ENG, "task")).toHaveLength(1);

    // Simulate the ephemeral-loss scenario: wipe the ledger rows.
    await db.delete(sheetSyncLedger);
    expect(await repo.listForEngagement(ENG, "task")).toHaveLength(0);

    // A fresh run re-banks the same identity.
    const res = await saveDbLedger(repo, ENG, ledgerOf([entry({})]), "run-2");
    expect(res.persisted).toBe(1);
    const rows = await repo.listForEngagement(ENG, "task");
    expect(rows).toHaveLength(1);
    expect(rows[0].runwayId).toBe("wi_kick");
  });

  it("round-trips through loadDbLedger", async () => {
    const repo = getSheetSyncLedger(db);
    await saveDbLedger(
      repo,
      ENG,
      ledgerOf([
        entry({ key: "1.1", weekItemId: "wi_kick", state: "matched", lastSeenContentHash: "h1" }),
        entry({ key: "t:buffer", weekItemId: "wi_buf", state: "collision-flagged", title: "Buffer", lastSeenContentHash: "h2" }),
      ]),
      "run-1"
    );
    const loaded = await loadDbLedger(repo, ENG, "sheet-x");
    expect(loaded.entries["1.1"].weekItemId).toBe("wi_kick");
    expect(loaded.entries["1.1"].state).toBe("matched");
    expect(loaded.entries["t:buffer"].state).toBe("collision-flagged");
    expect(loaded.entries["t:buffer"].lastSeenContentHash).toBe("h2");
  });
});
