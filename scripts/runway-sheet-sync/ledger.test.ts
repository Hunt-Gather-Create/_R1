import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import { contentHash, ledgerKey, linkEntry, loadLedger, reconcileLedger, saveLedger } from "./ledger";
import type { LeafTask, Ledger } from "./types";

function leaf(over: Partial<LeafTask>): LeafTask {
  return {
    rowNumber: 12,
    taskNo: "1.1",
    rawLabel: "   1.1 Kickoff",
    title: "Kickoff",
    resolvedTitle: "Kickoff",
    startDate: "2026-06-01",
    endDate: "2026-06-01",
    weekOf: "2026-06-01",
    completed: false,
    derivedStatus: "scheduled",
    category: "kickoff",
    section: null,
    priority: null,
    predecessorRow: null,
    lag: null,
    resource: null,
    notes: "",
    notesTruncated: false,
    sortOrder: 0,
    ...over,
  };
}

const tmp = mkdtempSync(join(tmpdir(), "sheet-sync-ledger-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("ledgerKey", () => {
  it("uses taskNo when present, normalized title otherwise", () => {
    expect(ledgerKey({ taskNo: "2.1", title: "Comps" })).toBe("2.1");
    expect(ledgerKey({ taskNo: null, title: "  Buffer /  Contingency " })).toBe("t:buffer / contingency");
  });
});

describe("bootstrap + round-trip", () => {
  it("bootstraps an empty ledger, links entries, persists, reloads", () => {
    const path = join(tmp, "ledger-round-trip.json");
    const empty = loadLedger(path, "sheet-x");
    expect(Object.keys(empty.entries)).toHaveLength(0);

    const tasks = [leaf({}), leaf({ taskNo: "2.1", title: "Comps", rowNumber: 14 })];
    const { ledger, renumbered, orphanedEntries } = reconcileLedger(empty, tasks, "run-1");
    expect(renumbered).toHaveLength(0);
    expect(orphanedEntries).toHaveLength(0);
    expect(ledger.entries["1.1"].state).toBe("pending-create");

    linkEntry(ledger, tasks[0], "wi_123", "matched");
    saveLedger(path, ledger);

    const reloaded = loadLedger(path, "sheet-x");
    expect(reloaded.entries["1.1"].weekItemId).toBe("wi_123");
    expect(reloaded.entries["1.1"].state).toBe("matched");
    expect(reloaded.lastRunId).toBe("run-1");
  });

  it("refuses a ledger belonging to another sheet", () => {
    const path = join(tmp, "ledger-wrong-sheet.json");
    saveLedger(path, { sheetId: "sheet-a", updatedAt: "", lastRunId: "", entries: {} });
    expect(() => loadLedger(path, "sheet-b")).toThrow(/belongs to sheet sheet-a/);
  });
});

describe("renumber reconciliation (§2.9 hazard 1)", () => {
  it("recovers WI linkage when a row insert shifts task numbers", () => {
    const prior: Ledger = {
      sheetId: "sheet-x",
      updatedAt: "",
      lastRunId: "run-1",
      entries: {
        "2.1": { key: "2.1", taskNo: "2.1", title: "Comps", rowNumber: 14, weekItemId: "wi_comps", state: "matched", lastSeenRunId: "run-1", lastSeenContentHash: null },
        "2.2": { key: "2.2", taskNo: "2.2", title: "Client review", rowNumber: 15, weekItemId: "wi_review", state: "matched", lastSeenRunId: "run-1", lastSeenContentHash: null },
      },
    };
    // A new 2.1 was inserted; old 2.1/2.2 became 2.2/2.3.
    const tasks = [
      leaf({ taskNo: "2.1", title: "Moodboards", rowNumber: 14, sortOrder: 0 }),
      leaf({ taskNo: "2.2", title: "Comps", rowNumber: 15, sortOrder: 1 }),
      leaf({ taskNo: "2.3", title: "Client review", rowNumber: 16, sortOrder: 2 }),
    ];
    const { ledger, renumbered, orphanedEntries } = reconcileLedger(prior, tasks, "run-2");

    // WI links must follow the TASK, not the key slot.
    expect(ledger.entries["2.2"].weekItemId).toBe("wi_comps");
    expect(ledger.entries["2.3"].weekItemId).toBe("wi_review");
    expect(ledger.entries["2.1"].weekItemId).toBeNull(); // Moodboards is new
    expect(ledger.entries["2.1"].state).toBe("pending-create");
    expect(renumbered).toEqual(
      expect.arrayContaining([
        { from: "2.1", to: "2.2", title: "Comps" },
        { from: "2.2", to: "2.3", title: "Client review" },
      ])
    );
    expect(orphanedEntries).toHaveLength(0);
  });

  it("recovers cleanly when renumber leaves no key overlap", () => {
    const prior: Ledger = {
      sheetId: "sheet-x",
      updatedAt: "",
      lastRunId: "run-1",
      entries: {
        "3.1": { key: "3.1", taskNo: "3.1", title: "Homepage Carousel build", rowNumber: 22, weekItemId: "wi_carousel", state: "matched", lastSeenRunId: "run-1", lastSeenContentHash: null },
      },
    };
    const tasks = [leaf({ taskNo: "4.1", title: "Homepage Carousel build", rowNumber: 30 })];
    const { ledger, renumbered, orphanedEntries } = reconcileLedger(prior, tasks, "run-2");

    expect(renumbered).toEqual([{ from: "3.1", to: "4.1", title: "Homepage Carousel build" }]);
    expect(ledger.entries["4.1"].weekItemId).toBe("wi_carousel");
    expect(ledger.entries["4.1"].state).toBe("matched");
    expect(orphanedEntries).toHaveLength(0);
  });
});

describe("row deletion (§2.9 hazard 3)", () => {
  it("orphans ledger entries whose rows disappeared — never deletes", () => {
    const prior: Ledger = {
      sheetId: "sheet-x",
      updatedAt: "",
      lastRunId: "run-1",
      entries: {
        "1.1": { key: "1.1", taskNo: "1.1", title: "Kickoff", rowNumber: 12, weekItemId: "wi_kick", state: "matched", lastSeenRunId: "run-1", lastSeenContentHash: null },
        "9.9": { key: "9.9", taskNo: "9.9", title: "Removed task", rowNumber: 99, weekItemId: "wi_gone", state: "matched", lastSeenRunId: "run-1", lastSeenContentHash: null },
      },
    };
    const { ledger, orphanedEntries } = reconcileLedger(prior, [leaf({})], "run-2");
    expect(orphanedEntries).toHaveLength(1);
    expect(orphanedEntries[0].weekItemId).toBe("wi_gone");
    expect(ledger.entries["9.9"]).toBeUndefined(); // dropped from forward ledger, surfaced as orphan
    expect(ledger.entries["1.1"].weekItemId).toBe("wi_kick");
  });
});

describe("contentHash (change detection over sheet cols B–J)", () => {
  it("is stable for identical structural content", () => {
    expect(contentHash(leaf({}))).toBe(contentHash(leaf({})));
  });

  it("changes when any structural field changes", () => {
    const base = contentHash(leaf({}));
    expect(contentHash(leaf({ completed: true }))).not.toBe(base);
    expect(contentHash(leaf({ title: "Different" }))).not.toBe(base);
    expect(contentHash(leaf({ startDate: "2026-07-01" }))).not.toBe(base);
    expect(contentHash(leaf({ endDate: "2026-07-01" }))).not.toBe(base);
    expect(contentHash(leaf({ priority: "P1" }))).not.toBe(base);
    expect(contentHash(leaf({ predecessorRow: 5 }))).not.toBe(base);
    expect(contentHash(leaf({ lag: 2 }))).not.toBe(base);
    expect(contentHash(leaf({ resource: "Lane" }))).not.toBe(base);
  });

  it("ignores positional / non-structural fields", () => {
    const base = contentHash(leaf({}));
    expect(contentHash(leaf({ rowNumber: 999 }))).toBe(base);
    expect(contentHash(leaf({ taskNo: "9.9" }))).toBe(base);
    expect(contentHash(leaf({ sortOrder: 42 }))).toBe(base);
    expect(contentHash(leaf({ notes: "irrelevant to identity" }))).toBe(base);
  });

  it("populates lastSeenContentHash on reconcile", () => {
    const { ledger } = reconcileLedger(
      { sheetId: "s", updatedAt: "", lastRunId: "", entries: {} },
      [leaf({})],
      "run-1"
    );
    expect(ledger.entries["1.1"].lastSeenContentHash).toBe(contentHash(leaf({})));
  });
});
