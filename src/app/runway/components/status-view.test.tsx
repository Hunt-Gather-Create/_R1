import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DayItem, DayItemEntry } from "../types";
import {
  StatusView,
  computeStatusItems,
  groupStatusItems,
} from "./status-view";

vi.mock("../actions", () => ({
  setWeekItemStatusAction: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

const TODAY = "2026-06-01";

function item(overrides: Partial<DayItemEntry> & { id: string; title: string; account: string }): DayItemEntry {
  return {
    type: "delivery",
    ...overrides,
  } as DayItemEntry;
}

function dayBucket(date: string, items: DayItemEntry[]): DayItem {
  return { date, label: date, items };
}

describe("computeStatusItems", () => {
  it("buckets stale → needs-update, today → today, in-flight predicate → in-flight", () => {
    const stale = [
      dayBucket("2026-05-28", [
        item({ id: "s1", title: "Stale A", account: "Acme", endDate: "2026-05-28" }),
      ]),
    ];
    const today = dayBucket(TODAY, [
      item({ id: "t1", title: "Today A", account: "Acme", startDate: TODAY, endDate: TODAY }),
    ]);
    const inFlight = [
      dayBucket("2026-05-25", [
        item({
          id: "f1",
          title: "InFlight A",
          account: "Acme",
          status: "in-progress",
          startDate: "2026-05-25",
          endDate: "2026-06-10",
        }),
      ]),
    ];
    const out = computeStatusItems(stale, today, inFlight, TODAY);
    const byId = new Map(out.map((e) => [e.item.id, e.bucket]));
    expect(byId.get("s1")).toBe("needs-update");
    expect(byId.get("t1")).toBe("today");
    expect(byId.get("f1")).toBe("in-flight");
  });

  it("dedupes an item across buckets — first pass (needs-update) wins", () => {
    const sharedItem = item({
      id: "x1",
      title: "Shared",
      account: "Acme",
      status: "in-progress",
      startDate: "2026-05-25",
      endDate: "2026-05-28",
    });
    const stale = [dayBucket("2026-05-28", [sharedItem])];
    const inFlight = [dayBucket("2026-05-25", [sharedItem])];
    const out = computeStatusItems(stale, null, inFlight, TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].bucket).toBe("needs-update");
  });

  it("forces blocked items into needs-update regardless of source bucket", () => {
    const today = dayBucket(TODAY, [
      item({
        id: "b1",
        title: "Blocked Today",
        account: "Acme",
        status: "blocked",
        startDate: TODAY,
        endDate: TODAY,
      }),
    ]);
    const out = computeStatusItems([], today, [], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0].bucket).toBe("needs-update");
  });

  it("skips items without an id (can't dedup safely)", () => {
    const today = dayBucket(TODAY, [
      { type: "delivery", title: "No id", account: "Acme" } as DayItemEntry,
    ]);
    const out = computeStatusItems([], today, [], TODAY);
    expect(out).toEqual([]);
  });

  it("ignores in-flight predicate misses (e.g. completed status)", () => {
    const inFlight = [
      dayBucket("2026-05-25", [
        item({
          id: "f-done",
          title: "Done in-progress range",
          account: "Acme",
          status: "completed",
          startDate: "2026-05-25",
          endDate: "2026-06-10",
        }),
      ]),
    ];
    expect(computeStatusItems([], null, inFlight, TODAY)).toEqual([]);
  });
});

describe("groupStatusItems", () => {
  it("groups by account alpha, project alpha, with cards date-ASC inside", () => {
    const items = [
      {
        bucket: "today" as const,
        item: item({
          id: "1",
          title: "Brand: Hero",
          account: "Bravo Corp",
          parentProjectName: "Brand Refresh",
          startDate: "2026-06-01",
        }),
      },
      {
        bucket: "in-flight" as const,
        item: item({
          id: "2",
          title: "Brand: Buttons",
          account: "Bravo Corp",
          parentProjectName: "Brand Refresh",
          startDate: "2026-05-15",
        }),
      },
      {
        bucket: "needs-update" as const,
        item: item({
          id: "3",
          title: "Alpha 1",
          account: "Acme Co",
          parentProjectName: "Alpha Build",
          startDate: "2026-05-20",
        }),
      },
    ];
    const groups = groupStatusItems(items);
    // Account alpha: Acme Co before Bravo Corp.
    expect(groups.map((g) => g.accountName)).toEqual(["Acme Co", "Bravo Corp"]);
    // Inside Bravo Corp / Brand Refresh: earlier date first.
    const bravoBrand = groups[1].projects[0];
    expect(bravoBrand.projectName).toBe("Brand Refresh");
    expect(bravoBrand.items.map((e) => e.item.id)).toEqual(["2", "1"]);
  });

  it("sorts blocked-with-no-endDate to top of its project (oldest updatedAtMs first)", () => {
    const items = [
      {
        bucket: "needs-update" as const,
        item: item({
          id: "a",
          title: "Active",
          account: "Acme Co",
          parentProjectName: "Alpha",
          startDate: "2026-05-15",
          endDate: "2026-05-20",
        }),
      },
      {
        bucket: "needs-update" as const,
        item: item({
          id: "b-recent",
          title: "Blocked recent",
          account: "Acme Co",
          parentProjectName: "Alpha",
          status: "blocked",
          endDate: null,
          updatedAtMs: 2000,
        }),
      },
      {
        bucket: "needs-update" as const,
        item: item({
          id: "b-old",
          title: "Blocked old",
          account: "Acme Co",
          parentProjectName: "Alpha",
          status: "blocked",
          endDate: null,
          updatedAtMs: 1000,
        }),
      },
    ];
    const groups = groupStatusItems(items);
    expect(groups[0].projects[0].items.map((e) => e.item.id)).toEqual([
      "b-old",
      "b-recent",
      "a",
    ]);
  });

  it("collapses items without parentProjectName into a single '(Other)' bucket", () => {
    const items = [
      {
        bucket: "today" as const,
        item: item({
          id: "x",
          title: "Stray",
          account: "Acme Co",
          startDate: TODAY,
        }),
      },
    ];
    const groups = groupStatusItems(items);
    expect(groups[0].projects.map((p) => p.projectName)).toEqual(["(Other)"]);
  });
});

describe("StatusView render", () => {
  it("renders an empty-state message when no items bucket in", () => {
    render(
      <StatusView
        staleItems={[]}
        todayColumn={null}
        inFlightSource={[]}
        nowISO={TODAY}
      />,
    );
    expect(screen.getByTestId("status-view-empty")).toBeInTheDocument();
  });

  it("renders an account section per surviving account, in alpha order", () => {
    const stale = [
      dayBucket("2026-05-28", [
        item({
          id: "1",
          title: "Item A",
          account: "Bravo",
          parentProjectName: "Bravo P",
          endDate: "2026-05-28",
        }),
      ]),
    ];
    const today = dayBucket(TODAY, [
      item({
        id: "2",
        title: "Item B",
        account: "Acme",
        parentProjectName: "Acme P",
        startDate: TODAY,
        endDate: TODAY,
      }),
    ]);
    render(
      <StatusView
        staleItems={stale}
        todayColumn={today}
        inFlightSource={[]}
        nowISO={TODAY}
      />,
    );
    const accounts = screen.getAllByTestId("status-view-account");
    expect(accounts.map((a) => a.getAttribute("data-account"))).toEqual([
      "Acme",
      "Bravo",
    ]);
  });

  it("attaches the correct bottom-banner color per card bucket", () => {
    const stale = [
      dayBucket("2026-05-28", [
        item({
          id: "needs",
          title: "Needs",
          account: "Acme",
          parentProjectName: "P",
          endDate: "2026-05-28",
        }),
      ]),
    ];
    const today = dayBucket(TODAY, [
      item({
        id: "today",
        title: "Today",
        account: "Acme",
        parentProjectName: "P",
        startDate: TODAY,
        endDate: TODAY,
      }),
    ]);
    const inFlight = [
      dayBucket("2026-05-25", [
        item({
          id: "flight",
          title: "InFlight",
          account: "Acme",
          parentProjectName: "P",
          status: "in-progress",
          startDate: "2026-05-25",
          endDate: "2026-06-10",
        }),
      ]),
    ];
    render(
      <StatusView
        staleItems={stale}
        todayColumn={today}
        inFlightSource={inFlight}
        nowISO={TODAY}
      />,
    );
    const banners = screen.getAllByTestId("bottom-banner");
    const buckets = banners.map((b) => b.getAttribute("data-bucket"));
    // Order inside project follows date ASC: in-flight (5/25), needs (5/28), today (6/1).
    expect(buckets).toEqual(["in-flight", "needs-update", "today"]);
  });

  it("does not render an account whose items all dedup out", () => {
    const dupe = item({
      id: "dup",
      title: "Dup",
      account: "Acme",
      parentProjectName: "P",
      status: "in-progress",
      startDate: "2026-05-25",
      endDate: "2026-05-28",
    });
    render(
      <StatusView
        staleItems={[dayBucket("2026-05-28", [dupe])]}
        todayColumn={null}
        inFlightSource={[dayBucket("2026-05-25", [dupe])]}
        nowISO={TODAY}
      />,
    );
    // 1 surviving account, 1 surviving card (deduped to needs-update).
    expect(screen.getAllByTestId("status-view-account")).toHaveLength(1);
    expect(screen.getAllByTestId("day-item-card")).toHaveLength(1);
  });

  it("groups cards under their project heading inside an account", () => {
    const today = dayBucket(TODAY, [
      item({
        id: "1",
        title: "Item 1",
        account: "Acme",
        parentProjectName: "Project Alpha",
        startDate: TODAY,
        endDate: TODAY,
      }),
      item({
        id: "2",
        title: "Item 2",
        account: "Acme",
        parentProjectName: "Project Beta",
        startDate: TODAY,
        endDate: TODAY,
      }),
    ]);
    render(
      <StatusView
        staleItems={[]}
        todayColumn={today}
        inFlightSource={[]}
        nowISO={TODAY}
      />,
    );
    const account = screen.getByTestId("status-view-account");
    const projects = within(account).getAllByTestId("status-view-project");
    expect(
      projects.map((p) => p.getAttribute("data-project")),
    ).toEqual(["Project Alpha", "Project Beta"]);
  });
});
