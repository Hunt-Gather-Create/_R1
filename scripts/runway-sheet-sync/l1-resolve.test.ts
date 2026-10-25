import { describe, expect, it } from "vitest";
import { diffSheet } from "./diff";
import { BUNDLE, emptyLedger, parsedWith } from "./diff.test-fixtures";
import { resolveL1 } from "./l1-resolve";
import { buildPayloads } from "./payloads";
import { renderReport } from "./report";
import { NO_STAFFING } from "./staffing";
import type { RunwayClientBundle } from "./runway-read";
import type { Ledger, ParsedSheet, SheetConfig } from "./types";

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

  it("Globex 2604-01 fixture: resolves via week-item-carry, does not propose a new project", () => {
    const config: SheetConfig = {
      sheetId: "globex-2604-01",
      clientSlug: "globex",
      engagementCode: "GLX-2604-01",
      label: "Phase 2.1 Homepage",
    };
    const parsed = parsedFor(config, {
      bannerCode: "GLX-2603-01",
      codeDrift: true,
    });
    const bundle: RunwayClientBundle = {
      client: { id: "cl_globex", slug: "globex", name: "Globex" },
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
    const diff = diffSheet(parsed, bundle, emptyLedger(), { runId: "run-globex", staffing: NO_STAFFING });
    expect(diff.l1.resolved).toBe(true);
    expect(diff.l1.projectId).toBe("p_revamp");
    expect(diff.l1.method).toBe("week-item-carry");
    const payloads = buildPayloads(diff, "run-globex");
    expect(payloads.some((p) => p.op === "addProject")).toBe(false);
  });

  it("Initech Loyalty Card fixture: no resolver fires, report reads 'no resolver fired', create still proposed", () => {
    const config: SheetConfig = {
      sheetId: "initech-loyalty-card",
      clientSlug: "initech",
      engagementCode: "INI-2602-01",
      label: "Loyalty Card Rebuild",
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
      client: { id: "cl_initech", slug: "initech", name: "Initech" },
      projects: [
        {
          id: "p_a",
          name: "Charity Campaign",
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
    const diff = diffSheet(parsed, bundle, emptyLedger(), { runId: "run-initech", staffing: NO_STAFFING });
    expect(diff.l1.resolved).toBe(false);
    expect(diff.l1.method).toBe("none");
    expect(diff.l1.reviewCandidate).toBeUndefined();
    expect(diff.l1.evidence?.map((e) => e.resolver).sort()).toEqual(
      ["code", "fuzzy", "ledger-identity", "week-item-carry"].sort()
    );
    const { report } = renderReport(diff, buildPayloads(diff, "run-initech"));
    expect(report).toContain("no resolver fired");
    const payloads = buildPayloads(diff, "run-initech");
    expect(payloads.some((p) => p.op === "addProject")).toBe(true);
  });
});
