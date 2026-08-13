import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "../../src/lib/runway/test-db";
import { getSheetSyncLedger } from "../../src/lib/runway/sheet-sync-ledger-repo";
import { loadDbLedger } from "./ledger-db";

const ENG = "SND-01";

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
