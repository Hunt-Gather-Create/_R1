import { describe, it, expect } from "vitest";
import { buildUnifiedAccounts } from "./unified-view";
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
});
