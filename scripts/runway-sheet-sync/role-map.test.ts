/**
 * Rule R1 as amended 2026-10-24: owner and resources come only from the
 * role map. Every map here is synthetic. The only first names used are the
 * ones the authority doc already quotes.
 */
import { describe, expect, it } from "vitest";
import { validateRoleTagOnResources } from "../../src/lib/runway/operations-utils";
import { diffSheet } from "./diff";
import { buildPayloads } from "./payloads";
import { NEVER_COMPARED_FIELDS, renderReport } from "./report";
import { planPeople, ROLE_MAP, splitLabels, type RoleMap } from "./role-map";
import type { RunwayClientBundle } from "./runway-read";
import type { LeafTask, Ledger, ParsedSheet } from "./types";

const MAP: RoleMap = {
  acme: {
    accountManager: "Kathy",
    clientLabels: ["BP", "Civ → Acme"],
    clientResource: { roleTag: "Client", person: "BP" },
    labels: {
      "Design + Creatives": { roleTag: "CD", person: "Lane" },
      "Dev + QA": { roleTag: "Dev", person: "Leslie" },
      Lane: { roleTag: "CD", person: "Lane" },
    },
  },
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

function parsedWith(tasks: LeafTask[]): ParsedSheet {
  return {
    config: { sheetId: "synthetic-sheet-id", clientSlug: "acme", engagementCode: "ACM-2601-01", label: "Widget Refresh" },
    meta: { bannerVariant: "A", engagementTitle: "Widget Refresh", bannerCode: "ACM-2601-01", codeDrift: false, headerRowNumber: 10 },
    rows: [],
    leafTasks: tasks,
    flags: [],
  };
}

const ledger = (): Ledger => ({ sheetId: "synthetic-sheet-id", updatedAt: "", lastRunId: "", entries: {} });

function bundle(wi: Partial<RunwayClientBundle["weekItems"][number]> = {}): RunwayClientBundle {
  return {
    client: { id: "cl_1", slug: "acme", name: "Acme" },
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

function run(tasks: LeafTask[], b: RunwayClientBundle, map: RoleMap = MAP) {
  const diff = diffSheet(parsedWith(tasks), b, ledger(), { runId: "run-1", roleMap: map });
  return { diff, payloads: buildPayloads(diff, "run-1") };
}

describe("acceptance 1: a mapped role plans owner and resources that pass validateRoleTagOnResources", () => {
  it("first label sets the owner, every mapped label sets resources, on a create", () => {
    const { payloads } = run([leaf({ resource: "Design + Creatives, Dev + QA" })], EMPTY_L1);
    const create = payloads.find((p) => p.op === "createWeekItem")!;
    expect(create.params.owner).toBe("Lane");
    expect(create.params.resources).toBe("CD: Lane, Dev: Leslie");
    expect(validateRoleTagOnResources(create.params.resources as string)).toEqual({ ok: true });
  });

  it("a matched row with an empty Runway owner and resources gets two writes", () => {
    const { diff, payloads } = run([leaf({ resource: "Design + Creatives" })], bundle());
    const writes = payloads.filter((p) => p.op === "updateWeekItemField");
    expect(writes.map((p) => [p.params.field, p.params.newValue])).toEqual([
      ["owner", "Lane"],
      ["resources", "CD: Lane"],
    ]);
    expect(validateRoleTagOnResources(writes[1].params.newValue as string)).toEqual({ ok: true });
    expect(diff.counts["role-map-refusals"]).toBe(0);
  });

  it("a Runway owner a person already set is flagged, never overwritten", () => {
    const { payloads } = run([leaf({ resource: "Design + Creatives" })], bundle({ owner: "Kathy", resources: "CD: Lane" }));
    expect(payloads.filter((p) => p.op === "updateWeekItemField")).toHaveLength(0);
    const flag = payloads.find((p) => p.op === "flag-for-review")!;
    expect(flag.params).toMatchObject({ field: "owner", sheetValue: "Lane", runwayValue: "Kathy" });
  });

  it("a person's first name in column J resolves through the map like a role", () => {
    expect(planPeople("Lane", "acme", MAP)).toEqual({ kind: "planned", owner: "Lane", resources: "CD: Lane" });
  });
});

describe("acceptance 2: a client-label row plans the client as resources and the account manager as owner", () => {
  it("BP plans resources Client: BP and owner Kathy", () => {
    const { payloads } = run([leaf({ resource: "BP" })], EMPTY_L1);
    const create = payloads.find((p) => p.op === "createWeekItem")!;
    expect(create.params.owner).toBe("Kathy");
    expect(create.params.resources).toBe("Client: BP");
    expect(validateRoleTagOnResources(create.params.resources as string)).toEqual({ ok: true });
  });

  it("an arrow inside a client label stays one label", () => {
    expect(splitLabels("Civ → Acme", MAP.acme)).toEqual(["Civ → Acme"]);
    expect(planPeople("Civ → Acme", "acme", MAP)).toEqual({ kind: "planned", owner: "Kathy", resources: "Client: BP" });
  });
});

describe("acceptance 3: an unmapped label plans neither field, adds one review item, and counts one refusal", () => {
  it("Account is not in the map", () => {
    const { diff, payloads } = run([leaf({ resource: "Account" })], EMPTY_L1);
    const create = payloads.find((p) => p.op === "createWeekItem")!;
    expect(create.params).not.toHaveProperty("owner");
    expect(create.params).not.toHaveProperty("resources");
    const reviews = payloads.filter((p) => p.params.policy === "role-map-refusal");
    expect(reviews).toHaveLength(1);
    expect(reviews[0].params.unmappedLabel).toBe("Account");
    expect(reviews[0].requiresReview).toBe(true);
    expect(diff.counts["role-map-refusals"]).toBe(1);
    const { report } = renderReport(diff, payloads);
    expect(report).toMatch(/\| role-map refusals, unmapped column J labels \| 1 \|/);
    expect(report).toMatch(/\| 12 \| 1\.1 \| Account \|/);
  });

  it("one unmapped label refuses the whole row, even beside a mapped one", () => {
    const { diff, payloads } = run([leaf({ resource: "Design + Creatives, Account" })], bundle());
    expect(payloads.some((p) => p.params.field === "owner" || p.params.field === "resources")).toBe(false);
    expect(diff.rowDiffs.find((r) => r.leaf)!.people).toEqual({ kind: "refused", unmapped: ["Account"] });
    expect(diff.counts["role-map-refusals"]).toBe(1);
  });

  it("a client with no map entry refuses every label, loud, not blank", () => {
    expect(ROLE_MAP).not.toHaveProperty("acme");
    const { diff, payloads } = run([leaf({ resource: "Design + Creatives" })], bundle(), ROLE_MAP);
    expect(diff.counts["role-map-refusals"]).toBe(1);
    expect(payloads.filter((p) => p.params.policy === "role-map-refusal")).toHaveLength(1);
  });

  it("an empty column J is no label, not a refusal", () => {
    const { diff } = run([leaf({ resource: null })], bundle());
    expect(diff.counts["role-map-refusals"]).toBe(0);
    expect(diff.rowDiffs.find((r) => r.leaf)!.people).toEqual({ kind: "no-label" });
  });
});

describe("a broken map entry fails loudly instead of writing a bad resources string", () => {
  it("a binding with no role tag throws", () => {
    const bad: RoleMap = { acme: { ...MAP.acme, labels: { Account: { roleTag: "", person: "Kathy" } } } };
    expect(() => planPeople("Account", "acme", bad)).toThrow(/ROLE MAP: client "acme"/);
  });
});

describe("acceptance 5: the diff report compares owner and resources", () => {
  it("owner and resources are no longer in the never-compared list", () => {
    expect(NEVER_COMPARED_FIELDS).toEqual(["category"]);
    expect(NEVER_COMPARED_FIELDS as readonly string[]).not.toContain("owner");
    expect(NEVER_COMPARED_FIELDS as readonly string[]).not.toContain("resources");
  });

  it("a planned row that already agrees reads compared, equal on both fields", () => {
    const { diff, payloads } = run([leaf({ resource: "Design + Creatives" })], bundle({ owner: "Lane", resources: "CD: Lane" }));
    const { report } = renderReport(diff, payloads);
    expect(report).toMatch(/- owner: compared, equal/);
    expect(report).toMatch(/- resources: compared, equal/);
    expect(report).toMatch(/- category: not compared/);
  });
});

describe("a label may bind to more than one role", () => {
  const LISTED: RoleMap = {
    acme: {
      ...MAP.acme,
      labels: {
        "Design + QA": [
          { roleTag: "CD", person: "Lane" },
          { roleTag: "QA", person: "Leslie" },
        ],
        "QA + Design": [
          { roleTag: "QA", person: "Leslie" },
          { roleTag: "CD", person: "Lane" },
        ],
      },
    },
  };

  it("plans every binding in order, and the first binding sets the owner", () => {
    expect(planPeople("Design + QA", "acme", LISTED)).toEqual({ kind: "planned", owner: "Lane", resources: "CD: Lane, QA: Leslie" });
    expect(planPeople("QA + Design", "acme", LISTED)).toEqual({ kind: "planned", owner: "Leslie", resources: "QA: Leslie, CD: Lane" });
  });

  it("checks every binding in the list, not only the first", () => {
    const bad: RoleMap = { acme: { ...MAP.acme, labels: { "Design + QA": [{ roleTag: "CD", person: "Lane" }, { roleTag: "", person: "Leslie" }] } } };
    expect(() => planPeople("Design + QA", "acme", bad)).toThrow(/ROLE MAP: client "acme"/);
  });

  it("a label bound to an empty list throws instead of planning no owner", () => {
    const empty: RoleMap = { acme: { ...MAP.acme, labels: { Design: [] } } };
    expect(() => planPeople("Design", "acme", empty)).toThrow(/bound to no role/);
  });
});

describe("the Ammonia build set plans what a person set by hand", () => {
  const cases: Array<[string, string, string]> = [
    ["Design + QA", "Lane", "CD: Lane, QA: Leslie"],
    ["Dev + QA", "Leslie", "Dev: Leslie"],
    ["Dev + Design", "Leslie", "Dev: Leslie, CD: Lane"],
    ["BP", "Kathy", "Client: Beyond Petro"],
    ["Civ + BP", "Kathy", "AM: Kathy, Client: Beyond Petro"],
    ["Account", "Kathy", "AM: Kathy"],
  ];

  it.each(cases)("%s plans owner %s, resources %s", (label, owner, resources) => {
    expect(planPeople(label, "beyond-petro", ROLE_MAP)).toEqual({ kind: "planned", owner, resources });
  });

  it("all six synthetic rows plan the same owner and resources on a create, through the shipped map", () => {
    const tasks = cases.map(([label], i) =>
      leaf({ rowNumber: 20 + i, taskNo: `2.${i + 1}`, title: `Task ${i + 1}`, resolvedTitle: `Task ${i + 1}`, resource: label, sortOrder: i })
    );
    const base = parsedWith(tasks);
    const parsed: ParsedSheet = { ...base, config: { ...base.config, clientSlug: "beyond-petro" } };
    const diff = diffSheet(parsed, EMPTY_L1, ledger(), { runId: "run-1", roleMap: ROLE_MAP });
    const creates = buildPayloads(diff, "run-1").filter((p) => p.op === "createWeekItem");
    expect(creates.map((p) => [p.params.title, p.params.owner, p.params.resources])).toEqual(
      cases.map(([, owner, resources], i) => [`Task ${i + 1}`, owner, resources])
    );
    expect(diff.counts["role-map-refusals"]).toBe(0);
  });
});
