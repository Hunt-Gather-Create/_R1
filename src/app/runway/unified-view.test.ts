import { describe, it, expect } from "vitest";
import { buildUnifiedAccounts, filterWrapperDayItems, wrapperIds } from "./unified-view";
import type { Account, DayItem, TriageItem } from "./types";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    name: "Convergix",
    slug: "convergix",
    contractStatus: "signed",
    items: [],
    ...overrides,
  };
}

function makeTriage(overrides: Partial<TriageItem> = {}): TriageItem {
  return {
    id: "p1",
    title: "Project A",
    status: "in-production",
    category: "active",
    ...overrides,
  };
}

function makeDay(items: DayItem["items"]): DayItem {
  return { date: "2026-04-20", label: "Mon 4/20", items };
}

describe("buildUnifiedAccounts", () => {
  it("attaches L2 milestones to their parent L1 by projectId", () => {
    const accounts = [
      makeAccount({
        items: [makeTriage({ id: "p1" }), makeTriage({ id: "p2", title: "Project B" })],
      }),
    ];
    const weekItems = [
      makeDay([
        { projectId: "p1", title: "M1", account: "Convergix", type: "delivery" },
        { projectId: "p2", title: "M2", account: "Convergix", type: "review" },
        { projectId: "p1", title: "M3", account: "Convergix", type: "delivery" },
      ]),
    ];

    const unified = buildUnifiedAccounts(accounts, weekItems);
    expect(unified[0].items[0].milestones.map((m) => m.title)).toEqual([
      "M1",
      "M3",
    ]);
    expect(unified[0].items[1].milestones.map((m) => m.title)).toEqual(["M2"]);
  });

  it("gives projects with no matching L2s an empty milestones array", () => {
    const accounts = [
      makeAccount({
        items: [makeTriage({ id: "p-alone" })],
      }),
    ];
    const weekItems: DayItem[] = [];
    const unified = buildUnifiedAccounts(accounts, weekItems);
    expect(unified[0].items[0].milestones).toEqual([]);
  });

  it("drops week items whose projectId is null or missing", () => {
    const accounts = [
      makeAccount({ items: [makeTriage({ id: "p1" })] }),
    ];
    const weekItems = [
      makeDay([
        { projectId: null, title: "Floating Item", account: "Convergix", type: "delivery" },
        { projectId: "p1", title: "Linked Item", account: "Convergix", type: "delivery" },
      ]),
    ];

    const unified = buildUnifiedAccounts(accounts, weekItems);
    expect(unified[0].items[0].milestones).toHaveLength(1);
    expect(unified[0].items[0].milestones[0].title).toBe("Linked Item");
  });

  it("preserves account-level fields without modification", () => {
    const accounts = [
      makeAccount({
        name: "HDL",
        slug: "hdl",
        contractStatus: "expired",
        contractValue: "$73K",
        team: "CD: Lane",
        items: [makeTriage({ id: "p1" })],
      }),
    ];

    const unified = buildUnifiedAccounts(accounts, []);
    expect(unified[0].name).toBe("HDL");
    expect(unified[0].slug).toBe("hdl");
    expect(unified[0].contractStatus).toBe("expired");
    expect(unified[0].contractValue).toBe("$73K");
    expect(unified[0].team).toBe("CD: Lane");
  });

  // ── Retainer wrapper tree-build (PR #88 Chunk F) ────────

  it("nests children under a retainer wrapper via parentProjectId", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "wrap", title: "Retainer Wrapper" }),
          makeTriage({ id: "c1", title: "Child A", parentProjectId: "wrap" }),
          makeTriage({ id: "c2", title: "Child B", parentProjectId: "wrap" }),
        ],
      }),
    ];

    const unified = buildUnifiedAccounts(accounts, []);
    // Top-level items now only contain the wrapper.
    expect(unified[0].items).toHaveLength(1);
    expect(unified[0].items[0].id).toBe("wrap");
    // Wrapper carries the two children under `children`.
    const children = unified[0].items[0].children ?? [];
    expect(children.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
  });

  it("falls back to 2-level when parentProjectId is null (unchanged legacy shape)", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "p1", parentProjectId: null }),
          makeTriage({ id: "p2", parentProjectId: null }),
        ],
      }),
    ];
    const unified = buildUnifiedAccounts(accounts, []);
    expect(unified[0].items).toHaveLength(2);
    // No wrapper => no children attached on any item.
    for (const item of unified[0].items) {
      expect(item.children).toBeUndefined();
    }
  });

  it("treats a missing wrapper id as top-level (no orphaning)", () => {
    const accounts = [
      makeAccount({
        items: [
          // The referenced wrapper is not in this account's items.
          makeTriage({ id: "lone-child", parentProjectId: "missing-wrap" }),
        ],
      }),
    ];
    const unified = buildUnifiedAccounts(accounts, []);
    // Still renders as top-level so the card doesn't silently disappear.
    expect(unified[0].items).toHaveLength(1);
    expect(unified[0].items[0].id).toBe("lone-child");
  });

  it("demotes grandparents to top-level (v4 is 2-tier max)", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "root", title: "Root" }),
          // `mid` is attempting to nest under root but ALSO holds its own child.
          makeTriage({ id: "mid", title: "Middle", parentProjectId: "root" }),
          // `leaf` points at `mid`, which itself has a parent — that's a grandparent chain.
          makeTriage({ id: "leaf", title: "Leaf", parentProjectId: "mid" }),
        ],
      }),
    ];
    const unified = buildUnifiedAccounts(accounts, []);
    // `mid` is correctly nested under root.
    const rootItem = unified[0].items.find((i) => i.id === "root");
    expect(rootItem?.children?.map((c) => c.id)).toEqual(["mid"]);
    // `leaf` is demoted to the top level rather than recursing beyond one tier.
    const leafItem = unified[0].items.find((i) => i.id === "leaf");
    expect(leafItem).toBeDefined();
    // And `leaf` is not nested inside `mid.children` (which should be empty or undefined).
    const midItem = rootItem?.children?.find((c) => c.id === "mid");
    expect(midItem?.children ?? []).toHaveLength(0);
  });

  it("still attaches L2 milestones on nested children via projectId", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "wrap", title: "Wrap" }),
          makeTriage({ id: "c1", title: "Child", parentProjectId: "wrap" }),
        ],
      }),
    ];
    const weekItems = [
      makeDay([
        { projectId: "c1", title: "Child Milestone", account: "Convergix", type: "delivery" },
      ]),
    ];
    const unified = buildUnifiedAccounts(accounts, weekItems);
    const wrap = unified[0].items[0];
    const child = wrap.children?.[0];
    expect(child?.milestones.map((m) => m.title)).toEqual(["Child Milestone"]);
  });
});

describe("wrapperIds", () => {
  it("identifies a retainer L1 that has ≥1 in-account child", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "wrap", engagementType: "retainer" }),
          makeTriage({ id: "c1", parentProjectId: "wrap" }),
        ],
      }),
    ];
    expect(wrapperIds(accounts).has("wrap")).toBe(true);
  });

  it("does NOT mark a retainer with zero children (Hopdoddy shape)", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "hopdoddy", engagementType: "retainer" }),
          // Unrelated standalone L1 — does not point at the retainer.
          makeTriage({ id: "other", parentProjectId: null }),
        ],
      }),
    ];
    expect(wrapperIds(accounts).size).toBe(0);
  });

  it("does NOT mark a non-retainer L1 even if it has children", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "proj", engagementType: "project" }),
          makeTriage({ id: "sub", parentProjectId: "proj" }),
        ],
      }),
    ];
    expect(wrapperIds(accounts).size).toBe(0);
  });
});

describe("filterWrapperDayItems", () => {
  it("returns the input unchanged when no wrappers exist", () => {
    const accounts = [
      makeAccount({ items: [makeTriage({ id: "p1", engagementType: "project" })] }),
    ];
    const weekItems = [
      makeDay([{ projectId: "p1", title: "M1", account: "Convergix", type: "delivery" }]),
    ];
    const filtered = filterWrapperDayItems(weekItems, accounts);
    expect(filtered).toEqual(weekItems);
  });

  it("strips DayItemEntries whose projectId matches a wrapper", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "wrap", engagementType: "retainer" }),
          makeTriage({ id: "c1", parentProjectId: "wrap" }),
        ],
      }),
    ];
    const weekItems = [
      makeDay([
        { projectId: "wrap", title: "Wrapper-direct M", account: "Convergix", type: "delivery" },
        { projectId: "c1", title: "Child M", account: "Convergix", type: "delivery" },
      ]),
    ];
    const filtered = filterWrapperDayItems(weekItems, accounts);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].items.map((i) => i.title)).toEqual(["Child M"]);
  });

  it("leaves Convergix-style data unchanged (wrappers have no direct L2s)", () => {
    const children = Array.from({ length: 15 }, (_, i) =>
      makeTriage({ id: `c${i}`, title: `Child ${i}`, parentProjectId: "wrap" }),
    );
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "wrap", title: "Convergix Retainer", engagementType: "retainer" }),
          ...children,
        ],
      }),
    ];
    const weekItems = [
      makeDay([
        { projectId: "c0", title: "M on child 0", account: "Convergix", type: "delivery" },
        { projectId: "c5", title: "M on child 5", account: "Convergix", type: "delivery" },
      ]),
    ];
    const filtered = filterWrapperDayItems(weekItems, accounts);
    expect(filtered).toEqual(weekItems);
  });

  it("drops empty days after filtering", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "wrap", engagementType: "retainer" }),
          makeTriage({ id: "c1", parentProjectId: "wrap" }),
        ],
      }),
    ];
    const weekItems = [
      makeDay([{ projectId: "wrap", title: "Only wrapper entry", account: "Convergix", type: "delivery" }]),
    ];
    expect(filterWrapperDayItems(weekItems, accounts)).toEqual([]);
  });

  it("is idempotent — calling twice returns the same result shape", () => {
    const accounts = [
      makeAccount({
        items: [
          makeTriage({ id: "wrap", engagementType: "retainer" }),
          makeTriage({ id: "c1", parentProjectId: "wrap" }),
        ],
      }),
    ];
    const weekItems = [
      makeDay([
        { projectId: "wrap", title: "Wrapper M", account: "Convergix", type: "delivery" },
        { projectId: "c1", title: "Child M", account: "Convergix", type: "delivery" },
      ]),
    ];
    const once = filterWrapperDayItems(weekItems, accounts);
    const twice = filterWrapperDayItems(once, accounts);
    expect(twice).toEqual(once);
    // Original input not mutated.
    expect(weekItems[0].items).toHaveLength(2);
  });
});
