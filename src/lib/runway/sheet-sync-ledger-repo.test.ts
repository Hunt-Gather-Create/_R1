import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedTestDb, cleanupTestDb, type TestDb } from "./test-db";
import { getSheetSyncLedger } from "./sheet-sync-ledger-repo";

describe("sheet-sync-ledger-repo", () => {
  let db: TestDb;
  let dbPath: string;

  beforeEach(async () => {
    const t = await createTestDb();
    await seedTestDb(t.client); // applies DDL (creates sheet_sync_ledger) + base seed
    db = t.db;
    dbPath = t.dbPath;
  });
  afterEach(() => cleanupTestDb(dbPath));

  it("registers and reads back by sheet key and runway id", async () => {
    const repo = getSheetSyncLedger(db);
    const res = await repo.register({
      engagementKey: "SND-01",
      entityType: "task",
      sheetKey: "1.1",
      runwayId: "wi_kick",
      lastSeenTitle: "Kickoff",
      lastSeenContentHash: "hash-a",
    });
    expect(res.ok).toBe(true);

    const bySheet = await repo.findBySheetKey("SND-01", "task", "1.1");
    expect(bySheet?.runwayId).toBe("wi_kick");
    const byRunway = await repo.findByRunwayId("wi_kick");
    expect(byRunway?.sheetKey).toBe("1.1");
    expect(byRunway?.state).toBe("active");
    expect(byRunway?.lastSeenContentHash).toBe("hash-a");
  });

  it("rejects a duplicate sheet key for the same engagement (collision)", async () => {
    const repo = getSheetSyncLedger(db);
    await repo.register({ engagementKey: "SND-01", entityType: "task", sheetKey: "1.1", runwayId: "wi_a" });
    const dup = await repo.register({
      engagementKey: "SND-01",
      entityType: "task",
      sheetKey: "1.1",
      runwayId: "wi_b",
    });
    expect(dup.ok).toBe(false);
  });

  it("touchByRunwayId refreshes content hash and state (E2 extension)", async () => {
    const repo = getSheetSyncLedger(db);
    await repo.register({
      engagementKey: "SND-01",
      entityType: "task",
      sheetKey: "1.1",
      runwayId: "wi_kick",
      lastSeenContentHash: "hash-a",
      lastSyncRunId: "run-1",
    });

    await repo.touchByRunwayId("wi_kick", {
      lastSeenTitle: "Kickoff v2",
      lastSyncRunId: "run-2",
      lastSeenContentHash: "hash-b",
      state: "flagged",
    });

    const entry = await repo.findByRunwayId("wi_kick");
    expect(entry?.lastSeenTitle).toBe("Kickoff v2");
    expect(entry?.lastSyncRunId).toBe("run-2");
    expect(entry?.lastSeenContentHash).toBe("hash-b");
    expect(entry?.state).toBe("flagged");
  });

  it("lists rows for an engagement filtered by entity type", async () => {
    const repo = getSheetSyncLedger(db);
    await repo.register({ engagementKey: "SND-01", entityType: "task", sheetKey: "1.1", runwayId: "wi_a" });
    await repo.register({ engagementKey: "SND-01", entityType: "task", sheetKey: "1.2", runwayId: "wi_b" });
    await repo.register({ engagementKey: "OTHER", entityType: "task", sheetKey: "1.1", runwayId: "wi_c" });

    const rows = await repo.listForEngagement("SND-01", "task");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sheetKey).sort()).toEqual(["1.1", "1.2"]);
  });
});
