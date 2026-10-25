import { describe, expect, it } from "vitest";
import { diffSheet } from "./diff";
import { BUNDLE, emptyLedger, leaf, parsedWith } from "./diff.test-fixtures";
import { buildPayloads } from "./payloads";
import { renderReport } from "./report";
import { NO_STAFFING } from "./staffing";
import type { RunwayClientBundle } from "./runway-read";

describe("diffSheet", () => {
  it("buckets matched / mismatched / missing and finds orphans", () => {
    const tasks = [
      leaf({}), // exact title match to wi_kick, but derived scheduled vs completed → flag
      leaf({
        rowNumber: 14,
        taskNo: "2.1",
        title: "Comps",
        resolvedTitle: "Comps",
        startDate: "2026-06-02",
        endDate: "2026-06-05",
        weekOf: "2026-06-01",
        sortOrder: 1,
      }), // endDate drift but blocked → protected
      leaf({
        rowNumber: 18,
        taskNo: "3.1",
        title: "Brand new task",
        resolvedTitle: "Brand new task",
        sortOrder: 2,
      }),
    ];
    const ledger = emptyLedger();
    // reconcile ledger first (normally done by CLI)
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, { runId: "run-1", staffing: NO_STAFFING });

    expect(diff.l1.projectId).toBe("p_widget");

    const kick = diff.rowDiffs.find((r) => r.leaf?.taskNo === "1.1")!;
    expect(kick.disposition).toBe("mismatched-field");
    expect(kick.deltas![0]).toMatchObject({
      field: "status",
      action: "flag-for-review",
    });

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
    const tasks = [
      leaf({
        title: "Logo pass v2",
        resolvedTitle: "Logo pass v2",
        taskNo: "7.1",
      }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    const rd = diff.rowDiffs.find((r) => r.leaf)!;
    expect(rd.disposition).toBe("missing-in-runway");
    expect(rd.weekItemId).toBeUndefined();
  });

  it("skips orphan analysis for unfilled templates (zero leaf tasks)", () => {
    const diff = diffSheet(parsedWith([]), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    expect(diff.orphans).toHaveLength(0);
    expect(diff.counts["runway-only-orphan"]).toBe(0);
    expect(
      diff.flags.some((f) =>
        f.includes("orphan analysis skipped (unfilled template)")
      )
    ).toBe(true);
  });

  it("emits FORWARD ordering: endDate delta before startDate delta", () => {
    const tasks = [
      leaf({
        title: "Kickoff call",
        resolvedTitle: "Kickoff call",
        startDate: "2026-06-03",
        endDate: "2026-06-04",
        weekOf: "2026-06-01",
        completed: true,
        derivedStatus: "completed",
      }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    const kick = diff.rowDiffs.find((r) => r.leaf)!;
    const dateFields = kick
      .deltas!.filter((d) => d.field.endsWith("Date"))
      .map((d) => d.field);
    expect(dateFields).toEqual(["endDate", "startDate"]);
  });

  it("flags mid-week collision under a different L1 without adopting", () => {
    const tasks = [
      leaf({
        title: "Logo pass",
        resolvedTitle: "Logo pass",
        taskNo: "5.1",
        weekOf: "2026-06-01",
      }),
    ];
    const ledger = emptyLedger();
    ledger.entries["5.1"] = {
      key: "5.1",
      taskNo: "5.1",
      title: "Logo pass",
      rowNumber: 12,
      weekItemId: null,
      state: "pending-create",
      lastSeenRunId: "run-0",
    };
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, { runId: "run-1", staffing: NO_STAFFING });
    const rd = diff.rowDiffs.find((r) => r.leaf)!;
    expect(rd.disposition).toBe("missing-in-runway");
    expect(rd.collision).toBe(true);
    expect(diff.counts.collisions).toBe(1);
    expect(ledger.entries["5.1"].state).toBe("collision-flagged");
  });

  it("uses ledger-banked WI ids before fuzzy (ledger-first)", () => {
    const tasks = [
      leaf({
        title: "Renamed beyond recognition",
        resolvedTitle: "Renamed beyond recognition",
      }),
    ];
    const ledger = emptyLedger();
    ledger.entries["1.1"] = {
      key: "1.1",
      taskNo: "1.1",
      title: "Kickoff call",
      rowNumber: 12,
      weekItemId: "wi_kick",
      state: "matched",
      lastSeenRunId: "run-0",
    };
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, { runId: "run-1", staffing: NO_STAFFING });
    const rd = diff.rowDiffs.find((r) => r.leaf)!;
    expect(rd.weekItemId).toBe("wi_kick");
    expect(rd.note).toBe("ledger-banked match");
  });
});

describe("buildPayloads", () => {
  it("emits self-contained createWeekItem payloads with landmines pre-applied", () => {
    const tasks = [
      leaf({
        title: "Brand new task",
        resolvedTitle: "Brand new task [Design]",
        taskNo: "3.1",
      }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
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
    const diff = diffSheet(
      parsedWith([leaf({})]),
      noL1,
      emptyLedger(),
      { runId: "run-1", staffing: NO_STAFFING }
    );
    const payloads = buildPayloads(diff, "run-1");
    expect(payloads[0].op).toBe("addProject");
    expect(payloads[0].requiresReview).toBe(true);
  });

  it("splits mismatches into writes and review flags per §2.4", () => {
    const tasks = [
      leaf({
        rowNumber: 14,
        taskNo: "2.1",
        title: "Comps",
        resolvedTitle: "Comps",
        startDate: "2026-06-02",
        endDate: "2026-06-05",
        weekOf: "2026-06-01",
      }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
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
      leaf({
        rowNumber: 14,
        taskNo: "2.1",
        title: "Comps",
        resolvedTitle: "Comps",
        startDate: "2026-06-09",
        endDate: "2026-06-12",
        weekOf: "2026-06-08",
        completed: true,
        derivedStatus: "completed",
      }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    const update = buildPayloads(diff, "run-1").find(
      (p) => p.op === "updateWeekItemField"
    )!;
    // Helper looks up by (weekOf, weekItemTitle) against the Runway row.
    expect(update.params.weekOf).toBe("2026-06-01"); // NOT the sheet's 2026-06-08
    expect(update.params.weekItemTitle).toBe("Comps");
    expect(Object.keys(update.params).sort()).toEqual([
      "field",
      "newValue",
      "updatedBy",
      "weekItemTitle",
      "weekOf",
    ]);
    expect(update.advisory).toMatchObject({ weekItemId: "wi_comps" });
  });

  it("review-gates create payloads with unparseable dates (no weekOf derivable)", () => {
    const tasks = [
      leaf({
        title: "Dateless task",
        resolvedTitle: "Dateless task",
        startDate: null,
        endDate: null,
        weekOf: null,
      }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    const create = buildPayloads(diff, "run-1").find(
      (p) => p.op === "createWeekItem"
    )!;
    expect(create.requiresReview).toBe(true);
    expect(create.preflight.datesMissing).toBe(true);
    expect(create.reason).toContain("dates unparseable");
  });

  it("keeps sortOrder advisory, never a createWeekItem param", () => {
    const tasks = [
      leaf({ title: "Brand new task", resolvedTitle: "Brand new task" }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    const create = buildPayloads(diff, "run-1").find(
      (p) => p.op === "createWeekItem"
    )!;
    expect(create.params.sortOrder).toBeUndefined();
    expect(create.advisory).toMatchObject({ sortOrder: 0 });
  });

  it("brands canceled-status divergence with a terminal-state reason", () => {
    const canceledBundle: RunwayClientBundle = {
      ...BUNDLE,
      weekItems: [
        {
          id: "wi_c",
          projectId: "p_widget",
          title: "Kickoff call",
          weekOf: "2026-06-01",
          startDate: "2026-06-01",
          endDate: "2026-06-01",
          status: "canceled",
          category: null,
          notes: null,
        },
      ],
    };
    const tasks = [leaf({ completed: true, derivedStatus: "completed" })];
    const diff = diffSheet(
      parsedWith(tasks),
      canceledBundle,
      emptyLedger(),
      { runId: "run-1", staffing: NO_STAFFING }
    );
    const flag = buildPayloads(diff, "run-1").find(
      (p) => p.op === "flag-for-review"
    )!;
    expect(flag.reason).toContain("terminal-state divergence");
  });
});

describe("renderReport", () => {
  it("includes the first-run expectation note when zero matches", () => {
    const tasks = [
      leaf({ title: "Nothing like prod", resolvedTitle: "Nothing like prod" }),
    ];
    const diff = diffSheet(
      parsedWith(tasks),
      { ...BUNDLE, weekItems: [] },
      emptyLedger(),
      { runId: "run-1", staffing: NO_STAFFING }
    );
    const { report, error } = renderReport(diff, buildPayloads(diff, "run-1"));
    expect(report).toContain("Expected on a first run");
    expect(report).toContain("missing-in-runway");
    expect(error).toBe(false);
  });

  it("renders orphans with the never-delete policy note", () => {
    const diff = diffSheet(
      parsedWith([leaf({})]),
      BUNDLE,
      emptyLedger(),
      { runId: "run-1", staffing: NO_STAFFING }
    );
    const { report } = renderReport(diff, []);
    expect(report).toContain("Hand-created legacy item");
    expect(report).toContain("never deletes");
  });
});

describe("_R1#160 acceptance", () => {
  it("1: ledger-banked row with a drifted title AND weekOf gets both corrections", () => {
    const tasks = [
      leaf({
        title: "Kickoff Call Revised",
        resolvedTitle: "Kickoff Call Revised",
        weekOf: "2026-06-08",
      }),
    ];
    const ledger = emptyLedger();
    ledger.entries["1.1"] = {
      key: "1.1",
      taskNo: "1.1",
      title: "Kickoff call",
      rowNumber: 12,
      weekItemId: "wi_kick",
      state: "matched",
      lastSeenRunId: "run-0",
      lastSeenContentHash: null,
    };
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, { runId: "run-1", staffing: NO_STAFFING });
    const rd = diff.rowDiffs.find((r) => r.leaf)!;
    expect(rd.disposition).toBe("mismatched-field");
    const fields = rd.deltas!.map((d) => d.field);
    expect(fields).toContain("title");
    expect(fields).toContain("weekOf");
    const titleD = rd.deltas!.find((d) => d.field === "title")!;
    expect(titleD).toMatchObject({
      action: "write",
      sheet: "Kickoff Call Revised",
      runway: "Kickoff call",
    });
    const weekOfD = rd.deltas!.find((d) => d.field === "weekOf")!;
    expect(weekOfD).toMatchObject({
      action: "write",
      sheet: "2026-06-08",
      runway: "2026-06-01",
    });
  });

  it("2a: matched row with prod category kickoff is flagged, never a write; a second run is identical", () => {
    const tasks = [leaf({})]; // matches wi_kick, whose category is "kickoff"
    const diff1 = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    const rd1 = diff1.rowDiffs.find((r) => r.leaf)!;
    const catDeltas1 = (rd1.deltas ?? []).filter((d) => d.field === "category");
    expect(catDeltas1).toHaveLength(1);
    expect(catDeltas1[0]).toMatchObject({ action: "flag-for-review", runway: "kickoff" });
    expect(
      (rd1.deltas ?? []).some((d) => d.field === "category" && d.action === "write")
    ).toBe(false);

    const payloads1 = buildPayloads(diff1, "run-1");
    const catFlag = payloads1.find(
      (p) => p.op === "flag-for-review" && p.params.field === "category"
    )!;
    expect(catFlag).toBeDefined();
    expect(catFlag.params.runwayValue).toBe("kickoff");
    expect(catFlag.params.weekItemId).toBe("wi_kick");
    expect(catFlag.reason).toContain("category");

    // Same inputs, second run: identical, because nothing was written.
    const diff2 = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    const rd2 = diff2.rowDiffs.find((r) => r.leaf)!;
    expect((rd2.deltas ?? []).filter((d) => d.field === "category")).toEqual(catDeltas1);
  });

  it("2b: createWeekItem payload always carries category null, never a derived value", () => {
    const tasks = [
      leaf({
        title: "Brand new task",
        resolvedTitle: "Brand new task",
        taskNo: "9.1",
        category: "launch",
      }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    const create = buildPayloads(diff, "run-1").find((p) => p.op === "createWeekItem")!;
    expect(create.params.category).toBeNull();
  });

  it("3: fuzzy-only match with a drifted title is flagged, never corrected", () => {
    const tasks = [
      leaf({
        title: "Compps", // scores ~0.89 vs "Comps": above match floor, below identical
        resolvedTitle: "Compps",
        taskNo: "2.1",
        startDate: "2026-06-02",
        endDate: "2026-06-04",
        weekOf: "2026-06-01",
      }),
    ];
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    const rd = diff.rowDiffs.find((r) => r.leaf)!;
    expect(rd.weekItemId).toBe("wi_comps"); // confirms fuzzy match fired, not ledger
    const titleD = rd.deltas!.find((d) => d.field === "title")!;
    expect(titleD.action).toBe("flag-for-review");
    expect(
      (rd.deltas ?? []).some((d) => d.field === "title" && d.action === "write")
    ).toBe(false);
  });

  it("4: report shows compared-and-equal vs not-compared, per field", () => {
    const tasks = [leaf({})]; // matches wi_kick exactly on dates and weekOf
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), { runId: "run-1", staffing: NO_STAFFING });
    const { report } = renderReport(diff, buildPayloads(diff, "run-1"));
    expect(report).toMatch(/weekOf: compared, equal/);
    expect(report).toMatch(/category: not compared/);
    // No column J label on this row, so the map planned nothing to compare.
    expect(report).toMatch(/owner: not planned, no RESOURCE label on this row/);
    expect(report).toMatch(/resources: not planned, no RESOURCE label on this row/);
  });
});
