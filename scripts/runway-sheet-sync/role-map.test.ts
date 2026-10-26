/**
 * Rule R1: owner and resources come only from staffing, through the run's
 * diff and payloads. Every client and person here is invented.
 */
import { describe, expect, it } from "vitest";
import { validateRoleTagOnResources } from "../../src/lib/runway/operations-utils";
import { diffSheet } from "./diff";
import { buildPayloads } from "./payloads";
import { NEVER_COMPARED_FIELDS, renderReport } from "./report";
import { planPeople, splitLabels } from "./role-map";
import type { RunwayClientBundle } from "./runway-read";
import { NO_STAFFING, type Staffing } from "./staffing";
import { STAFFING } from "./staffing.test-fixtures";
import type { LeafTask, Ledger, ParsedSheet } from "./types";

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

function parsedWith(tasks: LeafTask[]): ParsedSheet {
  return {
    config: { sheetId: "synthetic-sheet-id", clientSlug: "northwind", engagementCode: "ACM-2601-01", label: "Widget Refresh" },
    meta: { bannerVariant: "A", engagementTitle: "Widget Refresh", bannerCode: "ACM-2601-01", codeDrift: false, headerRowNumber: 10 },
    rows: [],
    leafTasks: tasks,
    flags: [],
  };
}

const ledger = (): Ledger => ({ sheetId: "synthetic-sheet-id", updatedAt: "", lastRunId: "", entries: {} });

function bundle(wi: Partial<RunwayClientBundle["weekItems"][number]> = {}): RunwayClientBundle {
  return {
    client: { id: "cl_1", slug: "northwind", name: "Northwind Petro" },
    projects: [{ id: "p_widget", name: "Widget Refresh", status: "in-progress", category: null, notes: "ACM-2601-01 SOW" }],
    weekItems: [
      {
        id: "wi_kick",
        projectId: "p_widget",
        title: "Kickoff call",
        weekOf: "2026-06-01",
        startDate: "2026-06-01",
        endDate: "2026-06-01",
        status: "scheduled",
        category: null,
        owner: null,
        resources: null,
        notes: null,
        ...wi,
      },
    ],
  };
}

/** A bundle with no week items, so every leaf is a create. */
const EMPTY_L1: RunwayClientBundle = { ...bundle(), weekItems: [] };

function run(tasks: LeafTask[], b: RunwayClientBundle, staffing: Staffing = STAFFING) {
  const diff = diffSheet(parsedWith(tasks), b, ledger(), { runId: "run-1", staffing });
  return { diff, payloads: buildPayloads(diff, "run-1") };
}


describe("a resolved role plans owner and resources that pass validateRoleTagOnResources", () => {
  it("first label sets the owner, every resolved label sets resources, on a create", () => {
    const { payloads } = run([leaf({ resource: "Design + Creatives, Dev + QA" })], EMPTY_L1);
    const create = payloads.find((p) => p.op === "createWeekItem")!;
    expect(create.params.owner).toBe("Wren");
    expect(create.params.resources).toBe("CD: Wren, Dev: Quill");
    expect(validateRoleTagOnResources(create.params.resources as string)).toEqual({ ok: true });
  });

  it("a matched row with an empty Runway owner and resources gets two writes", () => {
    const { diff, payloads } = run([leaf({ resource: "Design + Creatives" })], bundle());
    const writes = payloads.filter((p) => p.op === "updateWeekItemField");
    expect(writes.map((p) => [p.params.field, p.params.newValue])).toEqual([
      ["owner", "Wren"],
      ["resources", "CD: Wren"],
    ]);
    expect(diff.counts["role-map-refusals"]).toBe(0);
  });

  it("a Runway owner a person already set is flagged, never overwritten", () => {
    const { payloads } = run([leaf({ resource: "Design + Creatives" })], bundle({ owner: "Marlo", resources: "CD: Wren" }));
    expect(payloads.filter((p) => p.op === "updateWeekItemField")).toHaveLength(0);
    const flag = payloads.find((p) => p.op === "flag-for-review")!;
    expect(flag.params).toMatchObject({ field: "owner", sheetValue: "Wren", runwayValue: "Marlo" });
  });
});

describe("a client-label row plans the client as resources and the account manager as owner", () => {
  it("NWP plans resources Client: Northwind Petro and owner Marlo", () => {
    const { payloads } = run([leaf({ resource: "NWP" })], EMPTY_L1);
    const create = payloads.find((p) => p.op === "createWeekItem")!;
    expect(create.params.owner).toBe("Marlo");
    expect(create.params.resources).toBe("Client: Northwind Petro");
    expect(validateRoleTagOnResources(create.params.resources as string)).toEqual({ ok: true });
  });

  it("a whole cell that is one nickname stays one label", () => {
    const withSlash: Staffing = {
      ...STAFFING,
      clients: { northwind: { ...STAFFING.clients.northwind, nicknames: ["N/W"] } },
    };
    expect(splitLabels("N/W", withSlash.clients.northwind)).toEqual(["N/W"]);
    expect(planPeople("N/W", "northwind", withSlash)).toEqual({ kind: "planned", owner: "Marlo", resources: "Client: Northwind Petro" });
  });
});

describe("an unresolved label plans neither field, adds one review item, and counts one refusal", () => {
  it("Copywriting has no vocabulary entry", () => {
    const { diff, payloads } = run([leaf({ resource: "Copywriting" })], EMPTY_L1);
    const create = payloads.find((p) => p.op === "createWeekItem")!;
    expect(create.params).not.toHaveProperty("owner");
    expect(create.params).not.toHaveProperty("resources");
    const reviews = payloads.filter((p) => p.params.policy === "role-map-refusal");
    expect(reviews).toHaveLength(1);
    expect(reviews[0].params.unmappedLabel).toBe("Copywriting");
    expect(reviews[0].requiresReview).toBe(true);
    expect(diff.counts["role-map-refusals"]).toBe(1);
    const { report } = renderReport(diff, payloads);
    expect(report).toMatch(/\| role-map refusals, unmapped column J labels \| 1 \|/);
    expect(report).toMatch(/\| 12 \| 1\.1 \| Copywriting \|/);
  });

  it("one unresolved label refuses the whole row, even beside a resolved one", () => {
    const { diff, payloads } = run([leaf({ resource: "Design + Creatives, Copywriting" })], bundle());
    expect(payloads.some((p) => p.params.field === "owner" || p.params.field === "resources")).toBe(false);
    expect(diff.rowDiffs.find((r) => r.leaf)!.people).toEqual({ kind: "refused", unmapped: ["Copywriting"] });
    expect(diff.counts["role-map-refusals"]).toBe(1);
  });

  it("a client with no staffing refuses every label, loud, not blank", () => {
    const { diff, payloads } = run([leaf({ resource: "Design + Creatives" })], bundle(), NO_STAFFING);
    expect(diff.counts["role-map-refusals"]).toBe(2);
    expect(payloads.filter((p) => p.params.policy === "role-map-refusal")).toHaveLength(2);
  });

  it("an empty column J is no label, not a refusal", () => {
    const { diff } = run([leaf({ resource: null })], bundle());
    expect(diff.counts["role-map-refusals"]).toBe(0);
    expect(diff.rowDiffs.find((r) => r.leaf)!.people).toEqual({ kind: "no-label" });
  });
});

describe("the diff report compares owner and resources and counts ignored team parts", () => {
  it("owner and resources are no longer in the never-compared list", () => {
    expect(NEVER_COMPARED_FIELDS).toEqual(["category"]);
  });

  it("a planned row that already agrees reads compared, equal on both fields", () => {
    const { diff, payloads } = run([leaf({ resource: "Design + Creatives" })], bundle({ owner: "Wren", resources: "CD: Wren" }));
    const { report } = renderReport(diff, payloads);
    expect(report).toMatch(/- owner: compared, equal/);
    expect(report).toMatch(/- resources: compared, equal/);
    expect(report).toMatch(/- category: not compared/);
  });

  it("each team part whose role is not in the vocabulary is counted in the report", () => {
    const { diff, payloads } = run([leaf({ resource: "Design" })], bundle());
    expect(diff.counts["staffing-ignored-parts"]).toBe(2);
    expect(renderReport(diff, payloads).report).toMatch(/\| staffing rows ignored, Account Teams role not in the vocabulary \| 2 \|/);
  });
});

describe("the six build-set shapes plan what a person set by hand", () => {
  const cases: Array<[string, string, string]> = [
    ["Design + QA", "Wren", "CD: Wren, QA: Quill"],
    ["Dev + QA", "Quill", "Dev: Quill"],
    ["Dev + Design", "Quill", "Dev: Quill, CD: Wren"],
    ["NWP", "Marlo", "Client: Northwind Petro"],
    ["Civ + NWP", "Marlo", "AM: Marlo, Client: Northwind Petro"],
    ["Account", "Marlo", "AM: Marlo"],
  ];

  it.each(cases)("%s plans owner %s, resources %s", (label, owner, resources) => {
    expect(planPeople(label, "northwind", STAFFING)).toEqual({ kind: "planned", owner, resources });
    expect(validateRoleTagOnResources(resources)).toEqual({ ok: true });
  });

  it("all six rows plan the same owner and resources on a create", () => {
    const tasks = cases.map(([label], i) =>
      leaf({ rowNumber: 20 + i, taskNo: `2.${i + 1}`, title: `Task ${i + 1}`, resolvedTitle: `Task ${i + 1}`, resource: label, sortOrder: i })
    );
    const diff = diffSheet(parsedWith(tasks), EMPTY_L1, ledger(), { runId: "run-1", staffing: STAFFING });
    const creates = buildPayloads(diff, "run-1").filter((p) => p.op === "createWeekItem");
    expect(creates.map((p) => [p.params.title, p.params.owner, p.params.resources])).toEqual(
      cases.map(([, owner, resources], i) => [`Task ${i + 1}`, owner, resources])
    );
    expect(diff.counts["role-map-refusals"]).toBe(0);
  });
});
