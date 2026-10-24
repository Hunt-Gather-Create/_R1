import { describe, expect, it } from "vitest";
import { assertPeopleFromRoleMap, computeParity, reconcileVerdicts, structuralProbeDiff } from "./compare";
import { ROLE_MAP, type RoleMap } from "../role-map";
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
// frozen sheet fixture and prod snapshot captured into the untracked
// .data-walks/ folder, never committed, since they hold client data.
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
    const result = computeParity(parsed, prodSnapshot, { runId: "test-run-id", roleMap: ROLE_MAP });
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
    const first = computeParity(parsed, prodSnapshot, { runId: "fixed-run-id", roleMap: ROLE_MAP });
    const second = computeParity(parsed, prodSnapshot, { runId: "fixed-run-id", roleMap: ROLE_MAP });
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
    const result = computeParity(parsed, prodSnapshot, { runId: "test-run-interventions-3", roleMap: ROLE_MAP });
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
    const result = computeParity(parsed, prodSnapshot, { runId: "test-run-interventions-0", roleMap: ROLE_MAP });
    expect(result.counts).toEqual({ AGREE: 1, DISAGREE: 0, TOOL_ONLY: 0, HAND_ONLY: 0 });
    expect(result.interventions).toBe(0);
  });
});

const MAP: RoleMap = {
  acme: {
    accountManager: "Kathy",
    clientLabels: ["BP"],
    clientResource: { roleTag: "Client", person: "BP" },
    labels: { "Design + Creatives": { roleTag: "CD", person: "Lane" } },
  },
};
const MAPPED_LEAF = leaf({ resource: "Design + Creatives" });

describe("assertPeopleFromRoleMap, owner and resources only from the role map, rule R1 as amended 2026-10-24", () => {
  it("control: a status write and a map-sourced owner write on a mapped row do not throw", () => {
    const payloads = [
      payload({}),
      payload({ params: { weekOf: "2026-06-01", weekItemTitle: "Kickoff call", field: "owner", newValue: "Lane", updatedBy: "sheet-sync:test" } }),
      payload({ op: "createWeekItem", params: { clientSlug: "acme", owner: "Lane", resources: "CD: Lane" } }),
    ];
    expect(() => assertPeopleFromRoleMap(payloads, "acme", [MAPPED_LEAF], MAP)).not.toThrow();
  });

  it("mutation A: FAILS when an updateWeekItemField payload writes an owner the map did not plan", () => {
    const payloads = [payload({ params: { weekOf: "2026-06-01", weekItemTitle: "Kickoff call", field: "owner", newValue: "Kathy", updatedBy: "sheet-sync:test" } })];
    expect(() => assertPeopleFromRoleMap(payloads, "acme", [MAPPED_LEAF], MAP)).toThrow(/op "updateWeekItemField" on row 12 plans "owner" = "Kathy" without a role map source/);
  });

  it("mutation B: FAILS when any payload carries resources directly on params for a row with no label", () => {
    const payloads = [payload({ op: "createWeekItem", params: { clientSlug: "acme", resources: "CD: Lane" } })];
    expect(() => assertPeopleFromRoleMap(payloads, "acme", [leaf({})], MAP)).toThrow(/plans "resources" = "CD: Lane" without a role map source/);
  });

  it("mutation C: FAILS when a flag-for-review payload proposes an owner for a row whose label the map refused", () => {
    const payloads = [
      payload({ op: "flag-for-review", params: { weekItemId: "wi-1", field: "owner", sheetValue: "Lane", runwayValue: null, policy: "flag-for-review" } }),
    ];
    expect(() => assertPeopleFromRoleMap(payloads, "acme", [leaf({ resource: "Account" })], MAP)).toThrow(/op "flag-for-review" on row 12 plans "owner"/);
  });

  it("mutation D: FAILS when a payload names resources for a row the run never parsed", () => {
    const payloads = [
      payload({ op: "flag-for-review", params: { weekItemId: "wi-1", field: "resources", sheetValue: "CD: Lane", runwayValue: null, policy: "flag-for-review" } }),
    ];
    expect(() => assertPeopleFromRoleMap(payloads, "acme", [], MAP)).toThrow(/plans "resources"/);
  });

  it("control: addProject, createWeekItem without people, and a refusal review item carry no owner or resources value", () => {
    const addProjectPayload = payload({ op: "addProject", params: { clientSlug: "acme", name: "Acme", notes: "n", updatedBy: "sheet-sync:test" } });
    const createWeekItemPayload = payload({ op: "createWeekItem", params: { clientSlug: "acme", projectName: "Acme", title: "t", status: "scheduled", category: null, notes: "", updatedBy: "sheet-sync:test" } });
    const refusal = payload({ op: "flag-for-review", params: { weekItemId: null, unmappedLabel: "Account", policy: "role-map-refusal" } });
    expect(() => assertPeopleFromRoleMap([addProjectPayload, createWeekItemPayload, refusal], "acme", [leaf({})], MAP)).not.toThrow();
  });

  it("computeParity reads the tool's role map plan: AGREE when prod holds the same owner and resources", () => {
    const parsed = parsedWith([MAPPED_LEAF]);
    const prodSnapshot = {
      clientSlug: "acme",
      capturedAt: "2026-10-24T00:00:00Z",
      client: { id: "c-1", slug: "acme", name: "Acme" },
      projects: [{ id: "p-1", name: "Widget Refresh", status: null, category: null, notes: "ACM-2601-01" }],
      weekItems: [prodRow({ category: "kickoff", owner: "Lane", resources: "CD: Lane" })],
    };
    const result = computeParity(parsed, prodSnapshot, { runId: "test-run-map", roleMap: MAP });
    expect(result.counts).toEqual({ AGREE: 1, DISAGREE: 0, TOOL_ONLY: 0, HAND_ONLY: 0 });
    const disagree = computeParity(parsed, { ...prodSnapshot, weekItems: [prodRow({ category: "kickoff", owner: "Kathy", resources: "CD: Lane" })] }, { runId: "test-run-map", roleMap: MAP });
    expect(disagree.rows[0].mismatchedFields).toEqual([{ field: "owner", tool: "Lane", hand: "Kathy" }]);
  });

  it("the structural probe itself is non-vacuous: it reaches both the write and flag-for-review branches", () => {
    // A live run's payload list is empty whenever every compared field
    // agrees. TP mutation finding, 2026-09-07: payloads.ts:93 changed to a
    // hardcoded field, real Ammonia CLI run produced zero payloads and did
    // not throw. If a future edit to structuralProbeDiff ever stops forcing
    // both branches, this goes red before the guard silently goes blind.
    const probePayloads = buildPayloads(structuralProbeDiff(), "structural-probe-test");
    expect(probePayloads.length).toBeGreaterThan(0);
    expect(probePayloads.some((p) => p.op === "updateWeekItemField")).toBe(true);
    expect(probePayloads.some((p) => p.op === "flag-for-review")).toBe(true);
  });

  it("FAILS when the structural probe's own write branch plans owner, the probe leaf has no label", () => {
    const probe = structuralProbeDiff();
    const mutatedProbePayloads = buildPayloads(probe, "structural-probe-test").map((p) =>
      p.op === "updateWeekItemField" ? { ...p, params: { ...p.params, field: "owner" } } : p
    );
    expect(() => assertPeopleFromRoleMap(mutatedProbePayloads, probe.config.clientSlug, [probe.rowDiffs[0].leaf!], MAP)).toThrow(/plans "owner"/);
  });

  it("FAILS when the structural probe's own flag-for-review branch plans resources", () => {
    const probe = structuralProbeDiff();
    const mutatedProbePayloads = buildPayloads(probe, "structural-probe-test").map((p) =>
      p.op === "flag-for-review" ? { ...p, params: { ...p.params, field: "resources" } } : p
    );
    expect(() => assertPeopleFromRoleMap(mutatedProbePayloads, probe.config.clientSlug, [probe.rowDiffs[0].leaf!], MAP)).toThrow(/op "flag-for-review" on row 1 plans "resources"/);
  });
});
