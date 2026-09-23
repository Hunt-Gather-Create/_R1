import { describe, expect, it } from "vitest";
import {
  categoryDelta,
  diffSheet,
  resolveL1,
  statusDelta,
  titleDelta,
  weekOfDelta,
} from "./diff";
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
    {
      id: "p_widget",
      name: "Widget Refresh",
      status: "in-progress",
      category: null,
      notes: "ACM-2601-01 SOW",
    },
    {
      id: "p_other",
      name: "Brand Guidelines",
      status: "in-progress",
      category: null,
      notes: null,
    },
  ],
  weekItems: [
    {
      id: "wi_kick",
      projectId: "p_widget",
      title: "Kickoff call",
      weekOf: "2026-06-01",
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      status: "completed",
      category: "kickoff",
      notes: null,
    },
    {
      id: "wi_comps",
      projectId: "p_widget",
      title: "Comps",
      weekOf: "2026-06-01",
      startDate: "2026-06-02",
      endDate: "2026-06-04",
      status: "blocked",
      category: "delivery",
      notes: null,
    },
    {
      id: "wi_hand",
      projectId: "p_widget",
      title: "Hand-created legacy item",
      weekOf: "2026-06-08",
      startDate: null,
      endDate: null,
      status: null,
      category: null,
      notes: null,
    },
    {
      id: "wi_othr",
      projectId: "p_other",
      title: "Logo pass",
      weekOf: "2026-06-01",
      startDate: null,
      endDate: null,
      status: null,
      category: null,
      notes: null,
    },
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
      projects: [
        {
          id: "p_drift",
          name: "Old Code Project",
          status: null,
          category: null,
          notes: "ACM-2600-99",
        },
      ],
    };
    const res = resolveL1(parsed, drifted);
    expect(res.resolved).toBe(true);
    expect(res.projectId).toBe("p_drift");
    expect(res.method).toBe("code");
  });

  it("falls back to fuzzy title, unresolved below threshold", () => {
    const noCode: RunwayClientBundle = {
      ...BUNDLE,
      projects: [
        {
          id: "p_x",
          name: "Totally Unrelated Thing",
          status: null,
          category: null,
          notes: null,
        },
      ],
    };
    const res = resolveL1(parsedWith([]), noCode);
    expect(res.resolved).toBe(false);
    expect(res.method).toBe("none");
  });
});

/**
 * _R1#153: resolveL1 as an ordered list of named resolvers: engagement-code,
 * ledger-identity, project-name fuzzy, week-item-carry. Each fixture below is
 * built so only its target resolver fires; every earlier resolver in the
 * list must miss, or that resolver would fire first and mask the one under
 * test. Comments on each fixture name what the OTHER resolvers see and why
 * they miss.
 */
describe("resolveL1: named resolvers (#153)", () => {
  function parsedFor(
    config: SheetConfig,
    meta: Partial<ParsedSheet["meta"]> = {}
  ): ParsedSheet {
    return {
      config,
      meta: {
        bannerVariant: "A",
        engagementTitle: config.label,
        bannerCode: config.engagementCode,
        codeDrift: false,
        headerRowNumber: 10,
        ...meta,
      },
      rows: [],
      leafTasks: [],
      flags: [],
    };
  }

  it("resolver 1, engagement-code: fires on a code match nothing else could solve", () => {
    const config: SheetConfig = {
      sheetId: "s-code",
      clientSlug: "acme",
      engagementCode: "ACM-9001-01",
      label: "Totally Different Words Nobody Fuzzy Matches",
    };
    const bundle: RunwayClientBundle = {
      client: { id: "cl_1", slug: "acme", name: "Acme" },
      projects: [
        {
          id: "p_code",
          name: "Random Name Co",
          status: null,
          category: null,
          notes: "ACM-9001-01 SOW",
        },
      ],
      weekItems: [
        {
          id: "wi_unrelated",
          projectId: "p_code",
          title: "Unrelated week item title",
          weekOf: null,
          startDate: null,
          endDate: null,
          status: null,
          category: null,
          notes: null,
        },
      ],
    };
    const res = resolveL1(parsedFor(config), bundle, emptyLedger());
    expect(res.resolved).toBe(true);
    expect(res.method).toBe("code");
    expect(res.projectId).toBe("p_code");
  });

  it("resolver 2, ledger-identity: fires on an L1 the ledger already banked, code and fuzzy both miss", () => {
    const config: SheetConfig = {
      sheetId: "s-ledger",
      clientSlug: "acme",
      engagementCode: "ZZZ-0000-00",
      label: "Nonmatching Engagement Words",
    };
    const bundle: RunwayClientBundle = {
      client: { id: "cl_1", slug: "acme", name: "Acme" },
      projects: [
        {
          id: "p_banked",
          name: "Banked Project Alpha",
          status: null,
          category: null,
          notes: null,
        },
      ],
      weekItems: [
        {
          id: "wi_banked",
          projectId: "p_banked",
          title: "Some unrelated week item",
          weekOf: null,
          startDate: null,
          endDate: null,
          status: null,
          category: null,
          notes: null,
        },
      ],
    };
    const ledger: Ledger = {
      sheetId: config.sheetId,
      updatedAt: "",
      lastRunId: "run-1",
      entries: {
        "1.1": {
          key: "1.1",
          taskNo: "1.1",
          title: "Some unrelated week item",
          rowNumber: 12,
          weekItemId: "wi_banked",
          state: "matched",
          lastSeenRunId: "run-1",
          lastSeenContentHash: null,
        },
      },
    };
    const res = resolveL1(parsedFor(config), bundle, ledger);
    expect(res.resolved).toBe(true);
    expect(res.method).toBe("ledger-identity");
    expect(res.projectId).toBe("p_banked");
  });

  it("resolver 3, project-name fuzzy: fires on a project-name match, no week item carries the title", () => {
    const config: SheetConfig = {
      sheetId: "s-fuzzy",
      clientSlug: "acme",
      engagementCode: "ZZZ-0000-00",
      label: "Brand Refresh Sprint",
    };
    const bundle: RunwayClientBundle = {
      client: { id: "cl_1", slug: "acme", name: "Acme" },
      projects: [
        {
          id: "p_brand",
          name: "Brand Refresh Sprint",
          status: null,
          category: null,
          notes: null,
        },
      ],
      weekItems: [
        {
          id: "wi_unrelated",
          projectId: "p_brand",
          title: "Unrelated week item title",
          weekOf: null,
          startDate: null,
          endDate: null,
          status: null,
          category: null,
          notes: null,
        },
      ],
    };
    const res = resolveL1(parsedFor(config), bundle, emptyLedger());
    expect(res.resolved).toBe(true);
    expect(res.method).toBe("fuzzy");
    expect(res.projectId).toBe("p_brand");
  });

  it("resolver 4, week-item-carry: fires when the engagement identity matches a week item title, not a project name", () => {
    const config: SheetConfig = {
      sheetId: "s-carry",
      clientSlug: "acme",
      engagementCode: "ZZZ-0000-00",
      label: "Phase 2.1 Homepage",
    };
    const bundle: RunwayClientBundle = {
      client: { id: "cl_1", slug: "acme", name: "Acme" },
      projects: [
        {
          id: "p_revamp",
          name: "Website Revamp",
          status: null,
          category: null,
          notes: null,
        },
      ],
      weekItems: [
        {
          id: "wi_phase21",
          projectId: "p_revamp",
          title: "Phase 2.1 Homepage",
          weekOf: null,
          startDate: null,
          endDate: null,
          status: null,
          category: null,
          notes: null,
        },
      ],
    };
    const res = resolveL1(parsedFor(config), bundle, emptyLedger());
    expect(res.resolved).toBe(true);
    expect(res.method).toBe("week-item-carry");
    expect(res.projectId).toBe("p_revamp");
    expect(res.weekItemCarry?.weekItemId).toBe("wi_phase21");
  });

  it("week-item-carry candidate below match threshold routes to review, does not resolve", () => {
    const config: SheetConfig = {
      sheetId: "s-carry-weak",
      clientSlug: "acme",
      engagementCode: "ZZZ-0000-00",
      label: "Phase 2.1 Homepage",
    };
    const bundle: RunwayClientBundle = {
      client: { id: "cl_1", slug: "acme", name: "Acme" },
      // "Homepage Phase Revision" scores 0.615 against "Phase 2.1 Homepage":
      // above the 0.55 candidate floor, below the 0.75 match floor.
      projects: [
        {
          id: "p_revamp",
          name: "Website Revamp",
          status: null,
          category: null,
          notes: null,
        },
      ],
      weekItems: [
        {
          id: "wi_weak",
          projectId: "p_revamp",
          title: "Homepage Phase Revision",
          weekOf: null,
          startDate: null,
          endDate: null,
          status: null,
          category: null,
          notes: null,
        },
      ],
    };
    const res = resolveL1(parsedFor(config), bundle, emptyLedger());
    expect(res.resolved).toBe(false);
    expect(res.reviewCandidate?.weekItemId).toBe("wi_weak");
    expect(res.reviewCandidate?.projectId).toBe("p_revamp");
  });

  it("LPPC 2604-01 fixture: resolves via week-item-carry, does not propose a new project", () => {
    const config: SheetConfig = {
      sheetId: "lppc-2604-01",
      clientSlug: "lppc",
      engagementCode: "LPP-2604-01",
      label: "Phase 2.1 Homepage",
    };
    const parsed = parsedFor(config, {
      bannerCode: "LPP-2603-01",
      codeDrift: true,
    });
    const bundle: RunwayClientBundle = {
      client: { id: "cl_lppc", slug: "lppc", name: "LPPC" },
      projects: [
        {
          id: "p_revamp",
          name: "Website Revamp",
          status: "in-progress",
          category: null,
          notes: null,
        },
      ],
      weekItems: [
        {
          id: "wi_phase21",
          projectId: "p_revamp",
          title: "Phase 2.1 Homepage",
          weekOf: "2026-06-01",
          startDate: null,
          endDate: null,
          status: "scheduled",
          category: null,
          notes: null,
        },
      ],
    };
    const diff = diffSheet(parsed, bundle, emptyLedger(), "run-lppc");
    expect(diff.l1.resolved).toBe(true);
    expect(diff.l1.projectId).toBe("p_revamp");
    expect(diff.l1.method).toBe("week-item-carry");
    const payloads = buildPayloads(diff, "run-lppc");
    expect(payloads.some((p) => p.op === "addProject")).toBe(false);
  });

  it("Soundly RX Card fixture: no resolver fires, report reads 'no resolver fired', create still proposed", () => {
    const config: SheetConfig = {
      sheetId: "soundly-rx-card",
      clientSlug: "soundly",
      engagementCode: "SND-2602-01",
      label: "RX Card Rebuild",
    };
    const parsed = parsedFor(config);
    parsed.leafTasks = [
      {
        rowNumber: 12,
        taskNo: "1.1",
        rawLabel: "1.1 Kickoff",
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
        notes: "[Sheet 1.1]",
        notesTruncated: false,
        sortOrder: 0,
      },
    ];
    const bundle: RunwayClientBundle = {
      client: { id: "cl_soundly", slug: "soundly", name: "Soundly" },
      projects: [
        {
          id: "p_a",
          name: "AARP Campaign",
          status: null,
          category: null,
          notes: null,
        },
        {
          id: "p_b",
          name: "Retail Signage",
          status: null,
          category: null,
          notes: null,
        },
      ],
      weekItems: [
        {
          id: "wi_x",
          projectId: "p_a",
          title: "Kickoff call",
          weekOf: null,
          startDate: null,
          endDate: null,
          status: null,
          category: null,
          notes: null,
        },
      ],
    };
    const diff = diffSheet(parsed, bundle, emptyLedger(), "run-soundly");
    expect(diff.l1.resolved).toBe(false);
    expect(diff.l1.method).toBe("none");
    expect(diff.l1.reviewCandidate).toBeUndefined();
    expect(diff.l1.evidence?.map((e) => e.resolver).sort()).toEqual(
      ["code", "fuzzy", "ledger-identity", "week-item-carry"].sort()
    );
    const { report } = renderReport(diff, buildPayloads(diff, "run-soundly"));
    expect(report).toContain("no resolver fired");
    const payloads = buildPayloads(diff, "run-soundly");
    expect(payloads.some((p) => p.op === "addProject")).toBe(true);
  });
});

describe("statusDelta (§2.4 update policy)", () => {
  it("never overwrites protected human-set statuses", () => {
    expect(statusDelta("scheduled", "blocked")?.action).toBe(
      "protected-no-write"
    );
    expect(statusDelta("completed", "at-risk")?.action).toBe(
      "protected-no-write"
    );
    expect(statusDelta("completed", "in-progress")?.action).toBe(
      "protected-no-write"
    );
  });

  it("flags completed-revert instead of writing", () => {
    expect(statusDelta("scheduled", "completed")?.action).toBe(
      "flag-for-review"
    );
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, "run-1");

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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
    const rd = diff.rowDiffs.find((r) => r.leaf)!;
    expect(rd.disposition).toBe("missing-in-runway");
    expect(rd.weekItemId).toBeUndefined();
  });

  it("skips orphan analysis for unfilled templates (zero leaf tasks)", () => {
    const diff = diffSheet(parsedWith([]), BUNDLE, emptyLedger(), "run-1");
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, "run-1");
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, "run-1");
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
    const diff = diffSheet(
      parsedWith([leaf({})]),
      noL1,
      emptyLedger(),
      "run-1"
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
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
      "run-1"
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
      "run-1"
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
      "run-1"
    );
    const { report } = renderReport(diff, []);
    expect(report).toContain("Hand-created legacy item");
    expect(report).toContain("never deletes");
  });
});

/**
 * _R1#160: full-field delta. weekOf and title join the correctable set;
 * category gains a flag-only policy. owner/resources stay OUT (rule R1,
 * _R1#159), unchanged by this ticket.
 */
describe("weekOfDelta (§2.4-style update policy, _R1#160)", () => {
  it("writes when the sheet's weekOf differs from Runway's", () => {
    expect(weekOfDelta("2026-06-08", "2026-06-01")).toMatchObject({
      field: "weekOf",
      sheet: "2026-06-08",
      runway: "2026-06-01",
      action: "write",
    });
  });

  it("writes against a null Runway weekOf", () => {
    expect(weekOfDelta("2026-06-01", null)?.action).toBe("write");
  });

  it("returns null when in agreement, or the sheet carries no weekOf", () => {
    expect(weekOfDelta("2026-06-01", "2026-06-01")).toBeNull();
    expect(weekOfDelta(null, "2026-06-01")).toBeNull();
  });
});

describe("categoryDelta (_R1#160, TP ruling 2026-09-22: flag-only, never a write)", () => {
  it("flags a non-null Runway category, naming the value; never a write", () => {
    const d = categoryDelta("kickoff");
    expect(d).toMatchObject({
      field: "category",
      sheet: null,
      runway: "kickoff",
      action: "flag-for-review",
    });
  });

  it("returns null on a null Runway category, nothing to flag, nothing to write", () => {
    expect(categoryDelta(null)).toBeNull();
  });
});

describe("titleDelta (_R1#160, depends on #153 ledger identity)", () => {
  it("writes the correction when the match came from ledger identity", () => {
    const d = titleDelta("New Title", "Old Title", true);
    expect(d).toMatchObject({
      field: "title",
      sheet: "New Title",
      runway: "Old Title",
      action: "write",
    });
  });

  it("flags, never writes, when the match came from fuzzy title alone", () => {
    const d = titleDelta("New Title", "Old Title", false);
    expect(d).toMatchObject({ field: "title", action: "flag-for-review" });
  });

  it("returns null when titles agree modulo normalization", () => {
    expect(titleDelta("Kickoff Call", "kickoff  call", true)).toBeNull();
    expect(titleDelta("Kickoff Call", "kickoff  call", false)).toBeNull();
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, ledger, "run-1");
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
    const diff1 = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
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
    const diff2 = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
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
    const diff = diffSheet(parsedWith(tasks), BUNDLE, emptyLedger(), "run-1");
    const { report } = renderReport(diff, buildPayloads(diff, "run-1"));
    expect(report).toMatch(/weekOf: compared, equal/);
    expect(report).toMatch(/owner: not compared/);
    expect(report).toMatch(/resources: not compared/);
  });
});
