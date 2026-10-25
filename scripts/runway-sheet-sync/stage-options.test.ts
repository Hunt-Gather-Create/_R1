/**
 * Every stage runs on the config its caller passes and reads none of its
 * own. Schedule discovery and the role map are mocked to throw on any read,
 * so a stage that reaches for either fails here.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { classifyRows } from "./classify";
import { deriveCategory, deriveStatus } from "./derive";
import { diffSheet } from "./diff";
import { parseSheet } from "./parse-sheet";
import { computeParity } from "./parity/compare";
import { buildPayloads } from "./payloads";
import type { RoleMap } from "./role-map";
import type { SheetConfig, SheetFixture } from "./types";

/** An object that throws on any read, standing in for shipped config. */
function forbidden(what: string): never {
  return new Proxy({}, {
    get() {
      throw new Error(`a stage read the shipped ${what}`);
    },
  }) as never;
}

vi.mock("./schedule-discovery", () => ({ discoverSchedules: forbidden("schedule discovery") }));
vi.mock("./role-map.data", () => ({ ROLE_MAP: forbidden("role map") }));

/** A registry entry and a role map the shipped config has never heard of. */
const REGISTRY_ENTRY: SheetConfig = {
  sheetId: "synthetic-options-sheet",
  clientSlug: "synthetic-co",
  engagementCode: "SYN-2601-01",
  label: "Synthetic Engagement",
};
const SYNTHETIC_MAP: RoleMap = {
  "synthetic-co": {
    accountManager: "Pat",
    clientLabels: ["Syn"],
    clientResource: { roleTag: "Client", person: "Syn" },
    labels: { Builder: { roleTag: "Dev", person: "Robin" } },
  },
};

const GRID: (string | undefined)[][] = [
  ["", "CIVILIZATION"],
  [],
  ["", "Synthetic Co | Project Plan"],
  [],
  ["", "Synthetic Engagement  |   SYN-2601-01"],
  [],
  [],
  [],
  [],
  ["", "✔", "TASKS", "PRIORITY", "START DATE", "DUE DATE", "DURATION", "PREDECESSOR", "LAG", "RESOURCE", "STATUS"],
  ["", "FALSE", "Build", "", "1-Jun-2026", "5-Jun-2026"],
  ["", "FALSE", "   1.1 Build the widget", "", "1-Jun-2026", "5-Jun-2026", "", "", "", "Builder"],
];
const FIXTURE: SheetFixture = {
  sheetId: REGISTRY_ENTRY.sheetId,
  tab: "Task Tracker & Gantt Chart",
  range: "A1:N",
  exportedAt: "2026-06-01T00:00:00Z",
  values: GRID,
};
const BUNDLE = {
  client: { id: "c-syn", slug: "synthetic-co", name: "Synthetic Co" },
  projects: [{ id: "p-syn", name: "Synthetic Engagement", status: null, category: null, notes: "SYN-2601-01" }],
  weekItems: [
    {
      id: "wi-syn",
      projectId: "p-syn",
      title: "Build the widget",
      weekOf: "2026-06-01",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      status: "scheduled",
      category: null,
      owner: null,
      resources: null,
      notes: null,
    },
  ],
};

describe("stages run on the options they are passed", () => {
  it("parse, diff and payloads plan people from a synthetic registry entry and role map", () => {
    const parsed = parseSheet(FIXTURE, { config: REGISTRY_ENTRY });
    expect(parsed.config).toBe(REGISTRY_ENTRY);
    expect(parsed.leafTasks.map((l) => l.title)).toEqual(["Build the widget"]);

    const ledger = { sheetId: REGISTRY_ENTRY.sheetId, updatedAt: "", lastRunId: "", entries: {} };
    const diff = diffSheet(parsed, BUNDLE, ledger, { runId: "run-options", roleMap: SYNTHETIC_MAP });
    expect(diff.runId).toBe("run-options");
    expect(diff.counts["role-map-refusals"]).toBe(0);
    const row = diff.rowDiffs.find((rd) => rd.leaf);
    expect(row?.people).toEqual({ kind: "planned", owner: "Robin", resources: "Dev: Robin" });
    expect(row?.deltas?.filter((d) => d.field === "owner" || d.field === "resources")).toEqual([
      { field: "owner", sheet: "Robin", runway: null, action: "write" },
      { field: "resources", sheet: "Dev: Robin", runway: null, action: "write" },
    ]);
    expect(buildPayloads(diff, "run-options").length).toBeGreaterThan(0);
  });

  it("the same diff with an empty role map refuses the label, so the map passed in is the one used", () => {
    const parsed = parseSheet(FIXTURE, { config: REGISTRY_ENTRY });
    const ledger = { sheetId: REGISTRY_ENTRY.sheetId, updatedAt: "", lastRunId: "", entries: {} };
    const diff = diffSheet(parsed, BUNDLE, ledger, { runId: "run-options", roleMap: {} });
    expect(diff.counts["role-map-refusals"]).toBe(1);
  });

  it("parity runs on the synthetic role map", () => {
    const parsed = parseSheet(FIXTURE, { config: REGISTRY_ENTRY });
    const snapshot = { clientSlug: "synthetic-co", capturedAt: "2026-06-01T00:00:00Z", ...BUNDLE };
    const result = computeParity(parsed, snapshot, { runId: "run-options", roleMap: SYNTHETIC_MAP });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].verdict).toBe("DISAGREE");
  });

  it("classify and derive take only their inputs", () => {
    expect(classifyRows(GRID).headerRowNumber).toBe(10);
    expect(deriveStatus(false)).toBe("scheduled");
    expect(deriveCategory("Build the widget", null)).toBe("delivery");
  });

  it("no stage module imports the registry or the role map data", () => {
    const stages = [
      "classify.ts",
      "derive.ts",
      "parse-sheet.ts",
      "l1-resolve.ts",
      "field-deltas.ts",
      "people-delta.ts",
      "diff.ts",
      "payloads.ts",
      "apply.ts",
      "parity/compare.ts",
    ];
    for (const file of stages) {
      const text = readFileSync(join(__dirname, file), "utf8");
      expect(text, file).not.toMatch(/from "\.\.?\/(schedule-discovery|discover-live|role-map\.data)"|\bROLE_MAP\b|\bdiscoverSchedules\b/);
    }
  });
});
