import { describe, expect, it } from "vitest";
import { diffSheet, resolveL1, statusDelta } from "./diff";
import { buildPayloads } from "./payloads";
import { renderReport } from "./report";
import type { RunwayClientBundle } from "./runway-read";
import type { LeafTask, Ledger, ParsedSheet, SheetConfig } from "./types";

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

function parsedWith(tasks: LeafTask[], flags: string[] = []): ParsedSheet {
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
    flags,
  };
}

function emptyLedger(): Ledger {
  return { sheetId: CONFIG.sheetId, updatedAt: "", lastRunId: "", entries: {} };
}

const BUNDLE: RunwayClientBundle = {
  client: { id: "cl_1", slug: "acme", name: "Acme" },
  projects: [
    { id: "p_widget", name: "Widget Refresh", status: "in-progress", category: null, notes: "ACM-2601-01 SOW" },
    { id: "p_other", name: "Brand Guidelines", status: "in-progress", category: null, notes: null },
  ],
  weekItems: [
    { id: "wi_kick", projectId: "p_widget", title: "Kickoff call", weekOf: "2026-06-01", startDate: "2026-06-01", endDate: "2026-06-01", status: "completed", category: "kickoff", notes: null },
    { id: "wi_comps", projectId: "p_widget", title: "Comps", weekOf: "2026-06-01", startDate: "2026-06-02", endDate: "2026-06-04", status: "blocked", category: "delivery", notes: null },
    { id: "wi_hand", projectId: "p_widget", title: "Hand-created legacy item", weekOf: "2026-06-08", startDate: null, endDate: null, status: null, category: null, notes: null },
    { id: "wi_othr", projectId: "p_other", title: "Logo pass", weekOf: "2026-06-01", startDate: null, endDate: null, status: null, category: null, notes: null },
  ],
};

describe("resolveL1", () => {
  it("prefers explicit code match over fuzzy", () => {
    const res = resolveL1(parsedWith([]), BUNDLE);
    expect(res.resolved).toBe(true);
    expect(res.projectId).toBe("p_widget");
    expect(res.method).toBe("code");
  });

  it("probes the drifted banner code when config code misses (R7)", () => {
    const parsed = parsedWith([]);
    parsed.meta.bannerCode = "ACM-2600-99";
    parsed.meta.codeDrift = true;
    const drifted: RunwayClientBundle = {
      ...BUNDLE,
      projects: [{ id: "p_drift", name: "Old Code Project", status: null, category: null, notes: "ACM-2600-99" }],
    };
    const res = resolveL1(parsed, drifted);
    expect(res.resolved).toBe(true);
    expect(res.projectId).toBe("p_drift");
    expect(res.method).toBe("code");
  });

  it("falls back to fuzzy title, unresolved below threshold", () => {
    const noCode: RunwayClientBundle = {
      ...BUNDLE,
      projects: [{ id: "p_x", name: "Totally Unrelated Thing", status: null, category: null, notes: null }],
    };
    const res = resolveL1(parsedWith([]), noCode);
    expect(res.resolved).toBe(false);
    expect(res.method).toBe("none");
  });
});

describe("statusDelta (§2.4 update policy)", () => {
  it("never overwrites protected human-set statuses", () => {
    expect(statusDelta("scheduled", "blocked")?.action).toBe("protected-no-write");
    expect(statusDelta("completed", "at-risk")?.action).toBe("protected-no-write");
    expect(statusDelta("completed", "in-progress")?.action).toBe("protected-no-write");
  });

  it("flags completed-revert instead of writing", () => {
    expect(statusDelta("scheduled", "completed")?.action).toBe("flag-for-review");
  });

  it("promotes scheduled → completed as the only safe write", () => {
    expect(statusDelta("completed", "scheduled")?.action).toBe("write");
    expect(statusDelta("completed", null)?.action).toBe("write"); // NULL ≡ scheduled during rollout
  });

  it("returns null when in agreement", () => {
    expect(statusDelta("scheduled", "scheduled")).toBeNull();
    expect(statusDelta("scheduled", null)).toBeNull();
  });
});

describe("diffSheet", () => {
  it("buckets matched / mismatched / missing and finds orphans", () => {
    const tasks = [
      leaf({}), // exact title match to wi_kick, but derived scheduled vs completed → flag
      leaf({ rowNumber: 14, taskNo: "2.1", title: "Comps", resolvedTitle: "Comps", startDate: "2026-06-02", endDate: "2026-06-05", weekOf: "2026-06-01", sortOrder: 1 }), // endDate drift but blocked → protected
      leaf({ rowNumber: 18, taskNo: "3.1", title: "Brand new task", resolvedTitle: "Brand new task", sortOrder: 2 }),
    ];
    const ledger = emptyLedger();
    // reconcile ledger first (normally done by CLI)
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, "run-1");

    expect(diff.l1.projectId).toBe("p_widget");

    const kick = diff.rowDiffs.find((r) => r.leaf?.taskNo === "1.1")!;
    expect(kick.disposition).toBe("mismatched-field");
    expect(kick.deltas![0]).toMatchObject({ field: "status", action: "flag-for-review" });

    const comps = diff.rowDiffs.find((r) => r.leaf?.taskNo === "2.1")!;
    expect(comps.disposition).toBe("mismatched-field");
    const compsFields = comps.deltas!.map((d) => `${d.field}:${d.action}`);
    expect(compsFields).toContain("endDate:write");
    expect(compsFields).toContain("status:protected-no-write");

    const newTask = diff.rowDiffs.find((r) => r.leaf?.taskNo === "3.1")!;
    expect(newTask.disposition).toBe("missing-in-runway");

    // wi_hand under p_widget unmatched → orphan; wi_othr under p_other is NOT an orphan of this L1.
    expect(diff.orphans.map((o) => o.weekItemId)).toEqual(["wi_hand"]);
    expect(diff.counts["runway-only-orphan"]).toBe(1);
  });

  it("never fuzzy-adopts a WI under a different L1 when the sheet's L1 is resolved", () => {
    // Only near-identical title lives under p_other; pool must stay L1-scoped.
    const tasks = [leaf({ title: "Logo pass v2", resolvedTitle: "Logo pass v2", taskNo: "7.1" })];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
    const rd = diff.rowDiffs.find((r) => r.leaf)!;
    expect(rd.disposition).toBe("missing-in-runway");
    expect(rd.weekItemId).toBeUndefined();
  });

  it("skips orphan analysis for unfilled templates (zero leaf tasks)", () => {
    const diff = diffSheet(parsedWith([]), BUNDLE, emptyLedger(), "run-1");
    expect(diff.orphans).toHaveLength(0);
    expect(diff.counts["runway-only-orphan"]).toBe(0);
    expect(diff.flags.some((f) => f.includes("orphan analysis skipped (unfilled template)"))).toBe(true);
  });

  it("emits FORWARD ordering: endDate delta before startDate delta", () => {
    const tasks = [
      leaf({ title: "Kickoff call", resolvedTitle: "Kickoff call", startDate: "2026-06-03", endDate: "2026-06-04", weekOf: "2026-06-01", completed: true, derivedStatus: "completed" }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
    const kick = diff.rowDiffs.find((r) => r.leaf)!;
    const dateFields = kick.deltas!.filter((d) => d.field.endsWith("Date")).map((d) => d.field);
    expect(dateFields).toEqual(["endDate", "startDate"]);
  });

  it("flags mid-week collision under a different L1 without adopting", () => {
    const tasks = [leaf({ title: "Logo pass", resolvedTitle: "Logo pass", taskNo: "5.1", weekOf: "2026-06-01" })];
    const ledger = emptyLedger();
    ledger.entries["5.1"] = { key: "5.1", taskNo: "5.1", title: "Logo pass", rowNumber: 12, weekItemId: null, state: "pending-create", lastSeenRunId: "run-0" };
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, "run-1");
    const rd = diff.rowDiffs.find((r) => r.leaf)!;
    expect(rd.disposition).toBe("missing-in-runway");
    expect(rd.collision).toBe(true);
    expect(diff.counts.collisions).toBe(1);
    expect(ledger.entries["5.1"].state).toBe("collision-flagged");
  });

  it("uses ledger-banked WI ids before fuzzy (ledger-first)", () => {
    const tasks = [leaf({ title: "Renamed beyond recognition", resolvedTitle: "Renamed beyond recognition" })];
    const ledger = emptyLedger();
    ledger.entries["1.1"] = { key: "1.1", taskNo: "1.1", title: "Kickoff call", rowNumber: 12, weekItemId: "wi_kick", state: "matched", lastSeenRunId: "run-0" };
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, "run-1");
    const rd = diff.rowDiffs.find((r) => r.leaf)!;
    expect(rd.weekItemId).toBe("wi_kick");
    expect(rd.note).toBe("ledger-banked match");
  });
});

describe("buildPayloads", () => {
  it("emits self-contained createWeekItem payloads with landmines pre-applied", () => {
    const tasks = [leaf({ title: "Brand new task", resolvedTitle: "Brand new task [Design]", taskNo: "3.1" })];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
    const payloads = buildPayloads(diff, "run-1");
    expect(payloads).toHaveLength(1);
    const p = payloads[0];
    expect(p.op).toBe("createWeekItem");
    expect(p.params).toMatchObject({
      clientSlug: "acme",
      projectName: "Widget Refresh",
      title: "Brand new task [Design]",
      status: "scheduled",
      weekOf: "2026-06-01",
      updatedBy: "sheet-sync:run-1",
    });
    expect(p.preflight.titleDisambiguated).toBe(true);
    expect(p.preflight.statusValid).toBe(true);
    expect(p.preflight.categoryValid).toBe(true);
  });

  it("proposes a review-gated addProject when L1 unresolved", () => {
    const noL1: RunwayClientBundle = { ...BUNDLE, projects: [], weekItems: [] };
    const diff = diffSheet(parsedWith([leaf({})]), noL1, emptyLedger(), "run-1");
    const payloads = buildPayloads(diff, "run-1");
    expect(payloads[0].op).toBe("addProject");
    expect(payloads[0].requiresReview).toBe(true);
  });

  it("splits mismatches into writes and review flags per §2.4", () => {
    const tasks = [
      leaf({ rowNumber: 14, taskNo: "2.1", title: "Comps", resolvedTitle: "Comps", startDate: "2026-06-02", endDate: "2026-06-05", weekOf: "2026-06-01" }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
    const payloads = buildPayloads(diff, "run-1");
    const ops = payloads.map((p) => p.op);
    expect(ops).toContain("updateWeekItemField"); // endDate write
    expect(ops).toContain("flag-for-review"); // blocked status protected
    const flagged = payloads.find((p) => p.op === "flag-for-review")!;
    expect(flagged.requiresReview).toBe(true);
  });

  it("shapes update params EXACTLY as UpdateWeekItemFieldParams with the RUNWAY row's weekOf", () => {
    // wi_comps lives in weekOf 2026-06-01; sheet task drifted to next week.
    const tasks = [
      leaf({ rowNumber: 14, taskNo: "2.1", title: "Comps", resolvedTitle: "Comps", startDate: "2026-06-09", endDate: "2026-06-12", weekOf: "2026-06-08", completed: true, derivedStatus: "completed" }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
    const update = buildPayloads(diff, "run-1").find((p) => p.op === "updateWeekItemField")!;
    // Helper looks up by (weekOf, weekItemTitle) against the Runway row.
    expect(update.params.weekOf).toBe("2026-06-01"); // NOT the sheet's 2026-06-08
    expect(update.params.weekItemTitle).toBe("Comps");
    expect(Object.keys(update.params).sort()).toEqual(["field", "newValue", "updatedBy", "weekItemTitle", "weekOf"]);
    expect(update.advisory).toMatchObject({ weekItemId: "wi_comps" });
  });

  it("review-gates create payloads with unparseable dates (no weekOf derivable)", () => {
    const tasks = [leaf({ title: "Dateless task", resolvedTitle: "Dateless task", startDate: null, endDate: null, weekOf: null })];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
    const create = buildPayloads(diff, "run-1").find((p) => p.op === "createWeekItem")!;
    expect(create.requiresReview).toBe(true);
    expect(create.preflight.datesMissing).toBe(true);
    expect(create.reason).toContain("dates unparseable");
  });

  it("keeps sortOrder advisory, never a createWeekItem param", () => {
    const tasks = [leaf({ title: "Brand new task", resolvedTitle: "Brand new task" })];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
    const create = buildPayloads(diff, "run-1").find((p) => p.op === "createWeekItem")!;
    expect(create.params.sortOrder).toBeUndefined();
    expect(create.advisory).toMatchObject({ sortOrder: 0 });
  });

  it("brands canceled-status divergence with a terminal-state reason", () => {
    const canceledBundle: RunwayClientBundle = {
      ...BUNDLE,
      weekItems: [{ id: "wi_c", projectId: "p_widget", title: "Kickoff call", weekOf: "2026-06-01", startDate: "2026-06-01", endDate: "2026-06-01", status: "canceled", category: null, notes: null }],
    };
    const tasks = [leaf({ completed: true, derivedStatus: "completed" })];
    const diff = diffSheet(parsedWith(tasks), canceledBundle, emptyLedger(), "run-1");
    const flag = buildPayloads(diff, "run-1").find((p) => p.op === "flag-for-review")!;
    expect(flag.reason).toContain("terminal-state divergence");
  });
});

describe("renderReport", () => {
  it("includes the first-run expectation note when zero matches", () => {
    const tasks = [leaf({ title: "Nothing like prod", resolvedTitle: "Nothing like prod" })];
    const diff = diffSheet(parsedWith(tasks), { ...BUNDLE, weekItems: [] }, emptyLedger(), "run-1");
    const md = renderReport(diff, buildPayloads(diff, "run-1"));
    expect(md).toContain("Expected on a first run");
    expect(md).toContain("missing-in-runway");
  });

  it("renders orphans with the never-delete policy note", () => {
    const diff = diffSheet(parsedWith([leaf({})]), BUNDLE, emptyLedger(), "run-1");
    const md = renderReport(diff, []);
    expect(md).toContain("Hand-created legacy item");
    expect(md).toContain("never deletes");
  });
});
