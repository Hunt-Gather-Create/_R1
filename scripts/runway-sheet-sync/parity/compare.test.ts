import { describe, expect, it } from "vitest";
import { assertToolNeverPlansField, computeParity, reconcileVerdicts, structuralProbeDiff } from "./compare";
import { buildPayloads } from "../payloads";
import type { ProdWeekItemRow } from "./types";
import type { LeafTask, ParsedSheet, RowDiff, SheetConfig, SyncPayload } from "../types";

function payload(over: Partial<SyncPayload>): SyncPayload {
  return {
    op: "updateWeekItemField",
    params: { weekOf: "2026-06-01", weekItemTitle: "Kickoff call", field: "status", newValue: "scheduled", updatedBy: "sheet-sync:test" },
    source: { sheetId: "s-1", rowNumber: 12, taskNo: "1.1" },
    applyOrder: 0,
    requiresReview: false,
    preflight: { statusValid: true, categoryValid: true },
    reason: "test payload",
    ...over,
  };
}

const CONFIG: SheetConfig = {
  sheetId: "synthetic-sheet-id",
  clientSlug: "acme",
  engagementCode: "ACM-2601-01",
  label: "Widget Refresh",
};

function leaf(over: Partial<LeafTask>): LeafTask {
  return {
    rowNumber: 12,
    taskNo: "1.1",
    rawLabel: "   1.1 Kickoff call",
    title: "Kickoff call",
    resolvedTitle: "Kickoff call",
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
    notes: "[Sheet 1.1]",
    notesTruncated: false,
    sortOrder: 0,
    ...over,
  };
}

function prodRow(over: Partial<ProdWeekItemRow>): ProdWeekItemRow {
  return {
    id: "wi-1",
    projectId: "p-1",
    title: "Kickoff call",
    weekOf: "2026-06-01",
    startDate: "2026-06-01",
    endDate: "2026-06-01",
    status: "scheduled",
    category: null,
    owner: null,
    resources: null,
    notes: null,
    ...over,
  };
}

function parsedWith(tasks: LeafTask[]): ParsedSheet {
  return {
    config: CONFIG,
    meta: {
      bannerVariant: "A",
      engagementTitle: "Widget Refresh",
      bannerCode: "ACM-2601-01",
      codeDrift: false,
      headerRowNumber: 10,
    },
    rows: [],
    leafTasks: tasks,
    flags: [],
  };
}

describe("reconcileVerdicts, the harness's own instrument, tested in isolation from diff.ts", () => {
  it("row the tool calls matched, with owner/resources/category all disagreeing, is DISAGREE", () => {
    const rowDiffs: RowDiff[] = [
      {
        disposition: "matched",
        leaf: leaf({}),
        weekItemId: "wi-1",
        weekItemTitle: "Kickoff call",
        weekItemWeekOf: "2026-06-01",
        matchScore: 1,
        deltas: [],
      },
    ];
    const prodById = new Map([
      ["wi-1", prodRow({ owner: "Lane", resources: "CD: Lane", category: null })],
    ]);
    const rows = reconcileVerdicts(rowDiffs, [], prodById);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("DISAGREE");
    const fields = rows[0].mismatchedFields.map((f) => f.field).sort();
    expect(fields).toEqual(["category", "owner", "resources"]);
    expect(rows[0].mismatchedFields.find((f) => f.field === "owner")).toEqual({
      field: "owner",
      tool: null,
      hand: "Lane",
    });
  });

  it("row that agrees on all six fields is AGREE", () => {
    const rowDiffs: RowDiff[] = [
      {
        disposition: "matched",
        leaf: leaf({}),
        weekItemId: "wi-1",
        weekItemTitle: "Kickoff call",
        weekItemWeekOf: "2026-06-01",
        matchScore: 1,
        deltas: [],
      },
    ];
    const prodById = new Map([["wi-1", prodRow({ category: "kickoff", owner: null, resources: null })]]);
    const rows = reconcileVerdicts(rowDiffs, [], prodById);
    expect(rows[0].verdict).toBe("AGREE");
    expect(rows[0].mismatchedFields).toEqual([]);
  });

  it("records HOW the match was made, ledger-banked vs fuzzy score do not render the same", () => {
    const rowDiffs: RowDiff[] = [
      {
        disposition: "matched",
        leaf: leaf({ taskNo: "1.1" }),
        weekItemId: "wi-1",
        weekItemTitle: "Kickoff call",
        matchScore: 1,
        deltas: [],
        note: "ledger-banked match",
      },
      {
        disposition: "matched",
        leaf: leaf({ taskNo: "1.2", rowNumber: 13, title: "Design sync" }),
        weekItemId: "wi-2",
        weekItemTitle: "Design sync-ish",
        matchScore: 0.16,
        deltas: [],
      },
    ];
    const prodById = new Map([
      ["wi-1", prodRow({ id: "wi-1", category: "kickoff" })],
      ["wi-2", prodRow({ id: "wi-2", title: "Design sync-ish", category: "kickoff" })],
    ]);
    const rows = reconcileVerdicts(rowDiffs, [], prodById);
    expect(rows[0].match).toEqual({ method: "ledger", score: 1 });
    expect(rows[1].match).toEqual({ method: "fuzzy", score: 0.16 });
    // Same verdict, AGREE, different match provenance. Must not collapse.
    expect(rows[0].verdict).toBe("AGREE");
    expect(rows[1].verdict).toBe("AGREE");
    expect(rows[0].match).not.toEqual(rows[1].match);
  });

  it("missing-in-runway becomes TOOL_ONLY", () => {
    const rowDiffs: RowDiff[] = [{ disposition: "missing-in-runway", leaf: leaf({}) }];
    const rows = reconcileVerdicts(rowDiffs, [], new Map());
    expect(rows[0].verdict).toBe("TOOL_ONLY");
    expect(rows[0].weekItemId).toBeNull();
  });

  it("an unclaimed prod orphan becomes HAND_ONLY", () => {
    const rows = reconcileVerdicts(
      [],
      [{ weekItemId: "wi-9", title: "Hand-only task", weekOf: "2026-06-08", status: "scheduled" }],
      new Map()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "HAND_ONLY", rowNumber: null, weekItemId: "wi-9" });
  });

  it("skipped-header/milestone/spacer/empty rows never produce a verdict", () => {
    const rowDiffs: RowDiff[] = [
      { disposition: "skipped-header" },
      { disposition: "skipped-milestone" },
      { disposition: "skipped-spacer" },
      { disposition: "skipped-empty" },
    ];
    expect(reconcileVerdicts(rowDiffs, [], new Map())).toEqual([]);
  });

  describe("broken-matcher guard, the harness's own instrument must fail loud, not report a plausible wrong answer", () => {
    it("FAILS when a disposition claims a weekItemId absent from the frozen prod snapshot", () => {
      const rowDiffs: RowDiff[] = [
        {
          disposition: "matched",
          leaf: leaf({}),
          weekItemId: "wi-does-not-exist",
          matchScore: 1,
          deltas: [],
        },
      ];
      expect(() => reconcileVerdicts(rowDiffs, [], new Map())).toThrow(/absent from the frozen prod snapshot/);
    });

    it("FAILS when two different sheet rows are matched to the same weekItemId", () => {
      const rowDiffs: RowDiff[] = [
        { disposition: "matched", leaf: leaf({ taskNo: "1.1" }), weekItemId: "wi-1", matchScore: 1, deltas: [] },
        {
          disposition: "matched",
          leaf: leaf({ taskNo: "1.2", rowNumber: 13, title: "Different task" }),
          weekItemId: "wi-1",
          matchScore: 0.9,
          deltas: [],
        },
      ];
      const prodById = new Map([["wi-1", prodRow({})]]);
      expect(() => reconcileVerdicts(rowDiffs, [], prodById)).toThrow(/claimed by more than one sheet row/);
    });

    it("control: the same two rows matched to two DIFFERENT real ids do not throw", () => {
      const rowDiffs: RowDiff[] = [
        { disposition: "matched", leaf: leaf({ taskNo: "1.1" }), weekItemId: "wi-1", matchScore: 1, deltas: [] },
        {
          disposition: "matched",
          leaf: leaf({ taskNo: "1.2", rowNumber: 13, title: "Different task" }),
          weekItemId: "wi-2",
          matchScore: 0.9,
          deltas: [],
        },
      ];
      const prodById = new Map([
        ["wi-1", prodRow({ id: "wi-1" })],
        ["wi-2", prodRow({ id: "wi-2", title: "Different task" })],
      ]);
      expect(() => reconcileVerdicts(rowDiffs, [], prodById)).not.toThrow();
    });

    it("FAILS when a matched disposition carries no weekItemId at all", () => {
      const rowDiffs: RowDiff[] = [{ disposition: "matched", leaf: leaf({}), matchScore: 1, deltas: [] }];
      expect(() => reconcileVerdicts(rowDiffs, [], new Map())).toThrow(/carries no weekItemId/);
    });
  });
});

// Unit test of the field comparator, not the milestone proof. Both sides of
// the comparison below are authored in this same file, so a broken
// comparator could be made to pass it. The real bar is a run against a
// frozen Ammonia sheet fixture and prod snapshot, docs/data-walks/fixtures/,
// captured separately per _R1#151 thread follow-up, TP note 2026-09-07.
describe("computeParity, comparator unit test: owner/resources/category on an 18-row synthetic scenario", () => {
  it("names exactly {owner, resources, category} when a synthetic scenario differs on exactly those fields", () => {
    const tasks: LeafTask[] = Array.from({ length: 18 }, (_, i) =>
      leaf({
        rowNumber: 12 + i,
        taskNo: `${i + 1}.1`,
        title: `Ammonia task ${i}`,
        resolvedTitle: `Ammonia task ${i}`,
        category: "kickoff", // tool always derives a non-null category
      })
    );
    const parsed = parsedWith(tasks);
    const prodSnapshot = {
      clientSlug: "beyond-petro",
      capturedAt: "2026-09-07T22:00:00Z",
      client: { id: "c-1", slug: "beyond-petro", name: "Beyond Petro" },
      projects: [{ id: "p-1", name: "Ammonia Landing Page", status: null, category: null, notes: "BPC-2605-01" }],
      weekItems: tasks.map((t, i) =>
        prodRow({
          id: `wi-${i}`,
          projectId: "p-1",
          title: t.title,
          weekOf: t.weekOf,
          startDate: t.startDate,
          endDate: t.endDate,
          status: t.derivedStatus, // dates/status agree, the measured baseline, lesson 13
          category: null, // prod convention: null, lesson 15
          owner: "Lane", // prod holds a real owner, lesson 14/16
          resources: "CD: Lane", // prod holds real resources, lesson 14/16
        })
      ),
    };
    const result = computeParity(parsed, prodSnapshot, "test-run-id");
    expect(result.rows).toHaveLength(18);
    expect(result.rows.every((r) => r.verdict === "DISAGREE")).toBe(true);
    for (const row of result.rows) {
      const fields = row.mismatchedFields.map((f) => f.field).sort();
      expect(fields).toEqual(["category", "owner", "resources"]);
    }
    expect(result.counts).toEqual({ AGREE: 0, DISAGREE: 18, TOOL_ONLY: 0, HAND_ONLY: 0 });
  });

  it("re-running on the same two frozen inputs produces a byte-identical result", () => {
    const tasks: LeafTask[] = [leaf({})];
    const parsed = parsedWith(tasks);
    const prodSnapshot = {
      clientSlug: "acme",
      capturedAt: "2026-09-07T22:00:00Z",
      client: { id: "c-1", slug: "acme", name: "Acme" },
      projects: [],
      weekItems: [prodRow({ id: "wi-x", owner: "Lane" })],
    };
    const first = computeParity(parsed, prodSnapshot, "fixed-run-id");
    const second = computeParity(parsed, prodSnapshot, "fixed-run-id");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("_R1#156 intervention count: HAND_ONLY + DISAGREE, the rows the tool could not resolve on its own", () => {
  it("2 HAND_ONLY + 1 DISAGREE reports interventions: 3, not the HAND_ONLY count alone", () => {
    const tasks: LeafTask[] = [leaf({ category: "kickoff" })]; // tool always derives a non-null category
    const parsed = parsedWith(tasks);
    const prodSnapshot = {
      clientSlug: "acme",
      capturedAt: "2026-09-14T22:00:00Z",
      client: { id: "c-1", slug: "acme", name: "Acme" },
      projects: [{ id: "p-1", name: "Widget Refresh", status: null, category: null, notes: "ACM-2601-01" }],
      weekItems: [
        // Matches the one leaf task, category disagrees (prod null vs
        // tool-derived "kickoff") -> DISAGREE.
        prodRow({ id: "wi-1", projectId: "p-1", title: "Kickoff call", weekOf: "2026-06-01", category: null }),
        // Two prod rows under the same L1 with no sheet counterpart at all
        // -> HAND_ONLY, HAND_ONLY.
        prodRow({ id: "wi-2", projectId: "p-1", title: "Prod-only task A", weekOf: "2026-06-08" }),
        prodRow({ id: "wi-3", projectId: "p-1", title: "Prod-only task B", weekOf: "2026-06-15" }),
      ],
    };
    const result = computeParity(parsed, prodSnapshot, "test-run-interventions-3");
    expect(result.counts).toEqual({ AGREE: 0, DISAGREE: 1, TOOL_ONLY: 0, HAND_ONLY: 2 });
    expect(result.interventions).toBe(3);

    // Mutation the ticket names by hand: a formula that counts only
    // HAND_ONLY (dropping DISAGREE) would report 2 here, not 3. This
    // assertion is the one that goes red under that mutation.
    expect(result.interventions).not.toBe(result.counts.HAND_ONLY);
    expect(result.interventions).toBe(result.counts.HAND_ONLY + result.counts.DISAGREE);
  });

  it("a run where every row agrees and nothing is prod-only reports interventions: 0", () => {
    const tasks: LeafTask[] = [leaf({ category: "kickoff" })];
    const parsed = parsedWith(tasks);
    const prodSnapshot = {
      clientSlug: "acme",
      capturedAt: "2026-09-14T22:00:00Z",
      client: { id: "c-1", slug: "acme", name: "Acme" },
      projects: [{ id: "p-1", name: "Widget Refresh", status: null, category: null, notes: "ACM-2601-01" }],
      weekItems: [
        prodRow({
          id: "wi-1",
          projectId: "p-1",
          title: "Kickoff call",
          weekOf: "2026-06-01",
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          status: "scheduled",
          category: "kickoff",
          owner: null,
          resources: null,
        }),
      ],
    };
    const result = computeParity(parsed, prodSnapshot, "test-run-interventions-0");
    expect(result.counts).toEqual({ AGREE: 1, DISAGREE: 0, TOOL_ONLY: 0, HAND_ONLY: 0 });
    expect(result.interventions).toBe(0);
  });
});

describe("assertToolNeverPlansField, guards toolPlannedFields' hardcoded null against a silent _R1#159 landing", () => {
  it("control: today's real updateWeekItemField payload, which only ever writes status/startDate/endDate, does not throw", () => {
    expect(() => assertToolNeverPlansField([payload({})], "owner")).not.toThrow();
    expect(() => assertToolNeverPlansField([payload({})], "resources")).not.toThrow();
  });

  it("mutation A: FAILS when an updateWeekItemField payload proposes writing the guarded field", () => {
    const payloads = [payload({ params: { weekOf: "2026-06-01", weekItemTitle: "Kickoff call", field: "owner", newValue: "Lane", updatedBy: "sheet-sync:test" } })];
    expect(() => assertToolNeverPlansField(payloads, "owner")).toThrow(/payloads\.ts now proposes writing "owner" via op "updateWeekItemField"/);
    expect(() => assertToolNeverPlansField(payloads, "resources")).not.toThrow();
  });

  it("mutation B: FAILS when any payload carries the guarded field directly on params, independent of op", () => {
    const payloads = [payload({ op: "createWeekItem", params: { clientSlug: "acme", resources: "CD: Lane" } })];
    expect(() => assertToolNeverPlansField(payloads, "resources")).toThrow(/payloads\.ts now plans "resources"/);
    expect(() => assertToolNeverPlansField(payloads, "owner")).not.toThrow();
  });

  it("mutation C: FAILS when a flag-for-review payload proposes writing the guarded field, the branch the op allowlist missed", () => {
    // TP mutation finding, 2026-09-08: payloads.ts:110's flag-for-review
    // branch also names its column via params.field, but the guard only
    // ever checked op === "updateWeekItemField". A payload routing an
    // owner/resources mismatch to flag-for-review instead of an
    // auto-write reached exit 0 on the real Ammonia pair. The fix drops
    // the op allowlist entirely: any op naming the guarded field via
    // params.field is a hit.
    const payloads = [
      payload({ op: "flag-for-review", params: { weekItemId: "wi-1", field: "owner", sheetValue: "Lane", runwayValue: null, policy: "flag-for-review" } }),
    ];
    expect(() => assertToolNeverPlansField(payloads, "owner")).toThrow(/payloads\.ts now proposes writing "owner" via op "flag-for-review"/);
    expect(() => assertToolNeverPlansField(payloads, "resources")).not.toThrow();
  });

  it("mutation D: FAILS when a flag-for-review payload proposes writing resources, same branch as mutation C with the other guarded field", () => {
    const payloads = [
      payload({ op: "flag-for-review", params: { weekItemId: "wi-1", field: "resources", sheetValue: "CD: Lane", runwayValue: null, policy: "flag-for-review" } }),
    ];
    expect(() => assertToolNeverPlansField(payloads, "resources")).toThrow(/payloads\.ts now proposes writing "resources" via op "flag-for-review"/);
    expect(() => assertToolNeverPlansField(payloads, "owner")).not.toThrow();
  });

  it("control: addProject and createWeekItem payloads never carry params.field, so the dropped op allowlist creates no false positive", () => {
    const addProjectPayload = payload({ op: "addProject", params: { clientSlug: "acme", name: "Acme", notes: "n", updatedBy: "sheet-sync:test" } });
    const createWeekItemPayload = payload({ op: "createWeekItem", params: { clientSlug: "acme", projectName: "Acme", title: "t", status: "scheduled", category: "kickoff", notes: "", updatedBy: "sheet-sync:test" } });
    expect(() => assertToolNeverPlansField([addProjectPayload, createWeekItemPayload], "owner")).not.toThrow();
    expect(() => assertToolNeverPlansField([addProjectPayload, createWeekItemPayload], "resources")).not.toThrow();
  });

  it("computeParity on real Ammonia-shaped input calls the guard and does not throw, today", () => {
    const tasks: LeafTask[] = Array.from({ length: 3 }, (_, i) =>
      leaf({ rowNumber: 12 + i, taskNo: `${i + 1}.1`, title: `Task ${i}`, resolvedTitle: `Task ${i}` })
    );
    const parsed = parsedWith(tasks);
    const prodSnapshot = {
      clientSlug: "beyond-petro",
      capturedAt: "2026-09-07T22:00:00Z",
      client: { id: "c-1", slug: "beyond-petro", name: "Beyond Petro" },
      projects: [],
      weekItems: tasks.map((t, i) => prodRow({ id: `wi-${i}`, title: t.title, weekOf: t.weekOf, owner: "Lane" })),
    };
    expect(() => computeParity(parsed, prodSnapshot, "test-run-id")).not.toThrow();
  });

  it("the structural probe itself is non-vacuous: it reaches both the write and flag-for-review branches", () => {
    // A live run's payload list is empty whenever status/startDate/endDate
    // all agree, exactly the shape the test above exercises and exactly
    // the shape every real DISAGREE row on owner/resources/category takes.
    // TP mutation finding, 2026-09-07: payloads.ts:93 changed to a
    // hardcoded field, real Ammonia CLI run produced zero payloads and did
    // not throw. This test guards the probe against the same failure
    // mode: if a future edit to structuralProbeDiff ever stops forcing
    // both branches, this goes red before the guard silently goes blind
    // again.
    const probePayloads = buildPayloads(structuralProbeDiff(), "structural-probe-test");
    expect(probePayloads.length).toBeGreaterThan(0);
    expect(probePayloads.some((p) => p.op === "updateWeekItemField")).toBe(true);
    expect(probePayloads.some((p) => p.op === "flag-for-review")).toBe(true);
  });

  it("FAILS when the structural probe's own write branch plans the guarded field, independent of any live sheet", () => {
    const mutatedProbePayloads = buildPayloads(structuralProbeDiff(), "structural-probe-test").map((p) =>
      p.op === "updateWeekItemField" ? { ...p, params: { ...p.params, field: "owner" } } : p
    );
    expect(() => assertToolNeverPlansField(mutatedProbePayloads, "owner")).toThrow(/payloads\.ts now proposes writing "owner"/);
  });

  it("FAILS when the structural probe's own flag-for-review branch plans the guarded field, the exact shape mutations C/D exercise on the real Ammonia pair", () => {
    const mutatedProbePayloads = buildPayloads(structuralProbeDiff(), "structural-probe-test").map((p) =>
      p.op === "flag-for-review" ? { ...p, params: { ...p.params, field: "resources" } } : p
    );
    expect(() => assertToolNeverPlansField(mutatedProbePayloads, "resources")).toThrow(/payloads\.ts now proposes writing "resources" via op "flag-for-review"/);
  });
});
