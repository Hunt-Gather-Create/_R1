import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the queries module
const mockGetClientsWithProjects = vi.fn();
const mockGetWeekItems = vi.fn();
const mockGetPipeline = vi.fn();

const mockGetStaleWeekItems = vi.fn().mockResolvedValue([]);

vi.mock("./queries", () => ({
  getClientsWithProjects: () => mockGetClientsWithProjects(),
  getWeekItems: () => mockGetWeekItems(),
  getPipeline: () => mockGetPipeline(),
  getStaleWeekItems: () => mockGetStaleWeekItems(),
}));

const mockAnalyzeFlags = vi.fn().mockReturnValue([]);
vi.mock("@/lib/runway/flags", () => ({
  analyzeFlags: (...args: unknown[]) => mockAnalyzeFlags(...args),
}));

// v4 chunk 3 #6: page loads view preferences for the In Flight toggle default.
vi.mock("@/lib/runway/view-preferences", () => ({
  getViewPreferences: vi.fn().mockResolvedValue({ inFlightToggle: true }),
}));

vi.mock("./runway-board", () => ({
  RunwayBoard: (props: Record<string, unknown>) => {
    // Expose props as data attributes for testing
    return <div data-testid="runway-board" data-props={JSON.stringify(props)} />;
  },
}));

vi.mock("./date-utils", () => ({
  getMondayISODate: (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    return d.toISOString().split("T")[0];
  },
  parseISODate: (dateStr: string) => new Date(dateStr + "T12:00:00"),
}));

import { render, screen } from "@testing-library/react";

// We need to import and render the server component
// In test env, async components work synchronously with mocks
import RunwayPage from "./page";

const client = {
  id: "c1", name: "Convergix", slug: "convergix",
  contractValue: "$100k", contractTerm: "Annual", contractStatus: "signed",
  team: "Lane, Kathy", clientContacts: null,
  createdAt: new Date(), updatedAt: new Date(),
  items: [{
    id: "p1", clientId: "c1", name: "CDS Messaging", status: "in-production",
    category: "active", owner: "Kathy", waitingOn: null,
    dueDate: null, notes: "Gate for CDS", staleDays: null, sortOrder: 0,
    createdAt: new Date(), updatedAt: new Date(),
  }],
};

const weekDay = {
  date: "2026-04-06", label: "Mon 4/6",
  items: [{ title: "CDS Review", account: "Convergix", type: "review" as const }],
};

const futureDay = {
  date: "2026-04-13", label: "Mon 4/13",
  items: [{ title: "Future", account: "Test", type: "delivery" as const }],
};

const pipelineItem = {
  id: "pl1", clientId: "c1", name: "New SOW", status: "sow-sent",
  estimatedValue: "$50,000", waitingOn: "Daniel", notes: null,
  sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
  accountName: "Convergix",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Use a fixed "today" that falls in the 4/6 week
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-06T12:00:00"));
});

describe("RunwayPage", () => {
  it("splits week items into thisWeek and upcoming", async () => {
    mockGetClientsWithProjects.mockResolvedValue([client]);
    mockGetWeekItems.mockResolvedValue([weekDay, futureDay]);
    mockGetPipeline.mockResolvedValue([pipelineItem]);

    const el = await RunwayPage();
    render(el);

    const board = screen.getByTestId("runway-board");
    const props = JSON.parse(board.getAttribute("data-props")!);

    expect(props.thisWeek).toHaveLength(1);
    expect(props.thisWeek[0].date).toBe("2026-04-06");
    expect(props.upcoming).toHaveLength(1);
    expect(props.upcoming[0].date).toBe("2026-04-13");
  });

  it("maps client DB shape to Account props", async () => {
    mockGetClientsWithProjects.mockResolvedValue([client]);
    mockGetWeekItems.mockResolvedValue([]);
    mockGetPipeline.mockResolvedValue([]);

    const el = await RunwayPage();
    render(el);

    const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);
    const account = props.accounts[0];

    expect(account.name).toBe("Convergix");
    expect(account.slug).toBe("convergix");
    expect(account.contractStatus).toBe("signed");
    expect(account.items[0].title).toBe("CDS Messaging");
    expect(account.items[0].status).toBe("in-production");
    expect(account.items[0].owner).toBe("Kathy");
  });

  it("maps pipeline DB shape to PipelineItem props", async () => {
    mockGetClientsWithProjects.mockResolvedValue([]);
    mockGetWeekItems.mockResolvedValue([]);
    mockGetPipeline.mockResolvedValue([pipelineItem]);

    const el = await RunwayPage();
    render(el);

    const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);
    const item = props.pipeline[0];

    expect(item.account).toBe("Convergix");
    expect(item.title).toBe("New SOW");
    expect(item.value).toBe("$50,000");
    expect(item.status).toBe("sow-sent");
    expect(item.waitingOn).toBe("Daniel");
  });

  it("handles null pipeline accountName as empty string", async () => {
    mockGetClientsWithProjects.mockResolvedValue([]);
    mockGetWeekItems.mockResolvedValue([]);
    mockGetPipeline.mockResolvedValue([{ ...pipelineItem, accountName: null }]);

    const el = await RunwayPage();
    render(el);

    const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);
    expect(props.pipeline[0].account).toBe("");
  });

  it("defaults null contractStatus to signed", async () => {
    mockGetClientsWithProjects.mockResolvedValue([{ ...client, contractStatus: null }]);
    mockGetWeekItems.mockResolvedValue([]);
    mockGetPipeline.mockResolvedValue([]);

    const el = await RunwayPage();
    render(el);

    const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);
    expect(props.accounts[0].contractStatus).toBe("signed");
  });

  it("excludes past week items", async () => {
    const pastDay = {
      date: "2026-03-30", label: "Mon 3/30",
      items: [{ title: "Old", account: "X", type: "delivery" as const }],
    };
    mockGetClientsWithProjects.mockResolvedValue([]);
    mockGetWeekItems.mockResolvedValue([pastDay, weekDay]);
    mockGetPipeline.mockResolvedValue([]);

    const el = await RunwayPage();
    render(el);

    const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);
    expect(props.thisWeek).toHaveLength(1);
    expect(props.upcoming).toHaveLength(0);
  });

  it("passes flags from analyzeFlags to RunwayBoard", async () => {
    const mockFlags = [{ id: "f1", type: "stale", severity: "warning", title: "Old", detail: "stale 14d" }];
    mockAnalyzeFlags.mockReturnValue(mockFlags);
    mockGetClientsWithProjects.mockResolvedValue([client]);
    mockGetWeekItems.mockResolvedValue([weekDay]);
    mockGetPipeline.mockResolvedValue([]);

    const el = await RunwayPage();
    render(el);

    const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);
    expect(props.flags).toEqual(mockFlags);
    expect(mockAnalyzeFlags).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: "Convergix" })]),
      expect.any(Array),
      expect.any(Array),
      expect.any(Array)
    );
  });

  it("passes staleItems from getStaleWeekItems to RunwayBoard", async () => {
    const staleDay = {
      date: "2026-04-05", label: "Sun 4/5",
      items: [{ title: "Stale Item", account: "Test", type: "review" }],
    };
    mockGetStaleWeekItems.mockResolvedValue([staleDay]);
    mockGetClientsWithProjects.mockResolvedValue([]);
    mockGetWeekItems.mockResolvedValue([]);
    mockGetPipeline.mockResolvedValue([]);

    const el = await RunwayPage();
    render(el);

    const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);
    expect(props.staleItems).toEqual([staleDay]);
  });

  // Regression-lock: page.tsx pre-bucketing dropped past-Monday day buckets
  // before they reached InFlightSection, so multi-week in-progress items
  // silently disappeared from the In Flight section in production. The fix
  // builds `inFlightSource` from the FULL unfiltered getWeekItems() result
  // and passes it through alongside the bucketed thisWeek/upcoming.
  it("passes inFlightSource containing past-Monday day buckets while still bucketing thisWeek/upcoming", async () => {
    // "Today" is 2026-04-27 (Mon). currentWeekOf = 2026-04-27.
    vi.setSystemTime(new Date("2026-04-27T12:00:00"));

    const pastMondayBucket = {
      date: "2026-04-20", // Mon two weeks ago
      label: "Mon 4/20",
      items: [
        {
          title: "Past Monday In-Progress",
          account: "OldClient",
          type: "delivery" as const,
          // endDate intentionally mid-future so filterInFlight would keep it
          endDate: "2026-05-31",
        },
      ],
    };
    const thisWeekBucket = {
      date: "2026-04-27", // current Monday
      label: "Mon 4/27",
      items: [{ title: "Current", account: "X", type: "delivery" as const }],
    };
    const upcomingBucket = {
      date: "2026-05-04", // next Monday
      label: "Mon 5/4",
      items: [{ title: "Future", account: "X", type: "delivery" as const }],
    };

    mockGetClientsWithProjects.mockResolvedValue([]);
    mockGetWeekItems.mockResolvedValue([pastMondayBucket, thisWeekBucket, upcomingBucket]);
    mockGetPipeline.mockResolvedValue([]);

    const el = await RunwayPage();
    render(el);

    const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);

    // inFlightSource is the new prop — full unfiltered set including
    // past-Monday buckets that bucketing dropped.
    const inFlightDates = props.inFlightSource.map((d: { date: string }) => d.date);
    expect(inFlightDates).toContain("2026-04-20");
    expect(inFlightDates).toContain("2026-04-27");
    expect(inFlightDates).toContain("2026-05-04");

    // Existing bucketing must remain intact: thisWeek = current Mon only,
    // upcoming = future Mons only, past-Monday bucket dropped from both.
    const thisWeekDates = props.thisWeek.map((d: { date: string }) => d.date);
    const upcomingDates = props.upcoming.map((d: { date: string }) => d.date);
    expect(thisWeekDates).toEqual(["2026-04-27"]);
    expect(upcomingDates).toEqual(["2026-05-04"]);
    expect(thisWeekDates).not.toContain("2026-04-20");
    expect(upcomingDates).not.toContain("2026-04-20");
  });

  // Same-row dedup: the same week_item id appearing in BOTH Needs Update
  // (stale) AND In Flight (in-progress + today inside [start, end]) must
  // render only in Needs Update. Post-Commit 4 the predicates are mutually
  // exclusive at the row level, but the dedup is retained as defense-in-depth
  // against future regressions of that exclusivity.
  it("excludes a row from inFlightSource when the same row id is in staleItems (same-row dedup)", async () => {
    vi.setSystemTime(new Date("2026-04-27T12:00:00"));

    const collidingId = "wi-bonterra-ir";
    const staleDay = {
      date: "2026-04-20",
      label: "Mon 4/20",
      items: [{
        id: collidingId,
        title: "Impact Report — Dev IR Revisions",
        account: "Bonterra",
        type: "delivery" as const,
        projectId: "p-bonterra-ir",
      }],
    };
    const inFlightDay = {
      date: "2026-04-27",
      label: "Mon 4/27",
      items: [
        {
          id: collidingId,
          title: "Impact Report — Dev IR Revisions",
          account: "Bonterra",
          type: "delivery" as const,
          projectId: "p-bonterra-ir",
          status: "in-progress",
          startDate: "2026-04-20",
          endDate: "2026-05-31",
        },
        {
          id: "wi-other",
          title: "Other Live Work",
          account: "Bonterra",
          type: "delivery" as const,
          projectId: "p-other",
          status: "in-progress",
          startDate: "2026-04-20",
          endDate: "2026-05-31",
        },
      ],
    };

    mockGetClientsWithProjects.mockResolvedValue([]);
    mockGetWeekItems.mockResolvedValue([inFlightDay]);
    mockGetStaleWeekItems.mockResolvedValue([staleDay]);
    mockGetPipeline.mockResolvedValue([]);

    const el = await RunwayPage();
    render(el);
    const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);

    const staleTitles = props.staleItems.flatMap(
      (d: { items: { title: string }[] }) => d.items.map((i) => i.title)
    );
    expect(staleTitles).toContain("Impact Report — Dev IR Revisions");

    const inFlightTitles = props.inFlightSource.flatMap(
      (d: { items: { title: string }[] }) => d.items.map((i) => i.title)
    );
    expect(inFlightTitles).not.toContain("Impact Report — Dev IR Revisions");
    expect(inFlightTitles).toContain("Other Live Work");
  });

  // Multi-row in same project: when one L2 is overdue and another L2 in the
  // same project is actively in-flight, ID-based dedup keeps each row in its
  // correct section. Real example: HDL "Website Build" has parallel L2s
  // (Batch 1 Design, Batch 2 Design, Final Review); if Batch 1 goes overdue,
  // Batch 2 must remain visible in In Flight.
  it("keeps active sibling rows in inFlightSource when a different row in the same project is stale", async () => {
    vi.setSystemTime(new Date("2026-04-27T12:00:00"));

    const sharedProjectId = "p-hdl-website-build";
    const staleDay = {
      date: "2026-04-20",
      label: "Mon 4/20",
      items: [{
        id: "wi-batch-1-design",
        title: "Website Build — Batch 1 Design",
        account: "HDL",
        type: "delivery" as const,
        projectId: sharedProjectId,
      }],
    };
    const inFlightDay = {
      date: "2026-04-27",
      label: "Mon 4/27",
      items: [
        {
          id: "wi-batch-2-design",
          title: "Website Build — Batch 2 Design",
          account: "HDL",
          type: "delivery" as const,
          projectId: sharedProjectId,
          status: "in-progress",
          startDate: "2026-04-20",
          endDate: "2026-05-31",
        },
        {
          id: "wi-final-review",
          title: "Website Build — Final Review",
          account: "HDL",
          type: "delivery" as const,
          projectId: sharedProjectId,
          status: "in-progress",
          startDate: "2026-04-25",
          endDate: "2026-06-15",
        },
      ],
    };

    mockGetClientsWithProjects.mockResolvedValue([]);
    mockGetWeekItems.mockResolvedValue([inFlightDay]);
    mockGetStaleWeekItems.mockResolvedValue([staleDay]);
    mockGetPipeline.mockResolvedValue([]);

    const el = await RunwayPage();
    render(el);
    const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);

    const staleTitles = props.staleItems.flatMap(
      (d: { items: { title: string }[] }) => d.items.map((i) => i.title)
    );
    expect(staleTitles).toContain("Website Build — Batch 1 Design");

    const inFlightTitles = props.inFlightSource.flatMap(
      (d: { items: { title: string }[] }) => d.items.map((i) => i.title)
    );
    expect(inFlightTitles).toContain("Website Build — Batch 2 Design");
    expect(inFlightTitles).toContain("Website Build — Final Review");
  });

  // Commit 4 — end-to-end scenarios. These verify the bucket-key flip
  // (startDate-first for forward-looking sections, endDate-first for stale)
  // and the strict-start In Flight predicate together produce the expected
  // section membership for range and single-day items.
  describe("Commit 4: range-task / single-day section membership", () => {
    // Test 1 — multi-week range task surfaces in the right section per day.
    const rangeFixture = {
      startDate: "2026-06-03",
      endDate: "2026-06-30",
      date: "2026-06-30", // matches endDate per convention
      title: "Multi-week deliverable",
      account: "X",
      type: "delivery" as const,
      status: "in-progress",
      projectId: "p-range",
    };

    it("range task on day before kickoff appears in upcoming under its bucket column", async () => {
      vi.setSystemTime(new Date("2026-06-01T12:00:00")); // Mon, week-of 6/1

      mockGetClientsWithProjects.mockResolvedValue([]);
      mockGetWeekItems.mockResolvedValue([
        { date: "2026-06-30", label: "Tue 6/30", items: [rangeFixture] },
      ]);
      mockGetStaleWeekItems.mockResolvedValue([]);
      mockGetPipeline.mockResolvedValue([]);

      const el = await RunwayPage();
      render(el);
      const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);

      // page.test.tsx mocks getWeekItems directly, so the bucket key is
      // whatever the test fixture provides — the actual rekey to startDate
      // happens inside queries.ts and is covered by queries.test.ts. Here
      // we verify page.tsx's own week-membership wiring.
      const upcomingDates = props.upcoming.map((d: { date: string }) => d.date);
      expect(upcomingDates).toContain("2026-06-30");
    });

    it("range task in mid-flight appears in inFlightSource", async () => {
      vi.setSystemTime(new Date("2026-06-15T12:00:00")); // mid-range

      mockGetClientsWithProjects.mockResolvedValue([]);
      mockGetWeekItems.mockResolvedValue([
        { date: "2026-06-30", label: "Tue 6/30", items: [rangeFixture] },
      ]);
      mockGetStaleWeekItems.mockResolvedValue([]);
      mockGetPipeline.mockResolvedValue([]);

      const el = await RunwayPage();
      render(el);
      const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);

      const inFlightTitles = props.inFlightSource.flatMap(
        (d: { items: { title: string }[] }) => d.items.map((i) => i.title)
      );
      expect(inFlightTitles).toContain("Multi-week deliverable");
    });

    it("past-end range task surfaces in staleItems with day-group label keyed on endDate (Tue 6/30, not the kickoff Wed 6/3)", async () => {
      vi.setSystemTime(new Date("2026-07-01T12:00:00")); // past endDate

      mockGetClientsWithProjects.mockResolvedValue([]);
      mockGetWeekItems.mockResolvedValue([]);
      // staleItems comes from getStaleWeekItems which (per queries.ts) buckets
      // on endDate. Mock the bucketed shape directly.
      mockGetStaleWeekItems.mockResolvedValue([
        { date: "2026-06-30", label: "Tue 6/30", items: [rangeFixture] },
      ]);
      mockGetPipeline.mockResolvedValue([]);

      const el = await RunwayPage();
      render(el);
      const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);

      expect(props.staleItems).toHaveLength(1);
      expect(props.staleItems[0].date).toBe("2026-06-30");
      expect(props.staleItems[0].label).toBe("Tue 6/30");
    });

    // Test 2 — single-day deadline (date = startDate = endDate)
    const singleDayFixture = {
      startDate: "2026-05-15",
      endDate: "2026-05-15",
      date: "2026-05-15",
      title: "Single-day milestone",
      account: "X",
      type: "deadline" as const,
      status: "in-progress",
      projectId: "p-single",
    };

    it("single-day item on its day surfaces in thisWeek (todayColumn at the board layer)", async () => {
      vi.setSystemTime(new Date("2026-05-15T12:00:00"));

      mockGetClientsWithProjects.mockResolvedValue([]);
      mockGetWeekItems.mockResolvedValue([
        { date: "2026-05-15", label: "Fri 5/15", items: [singleDayFixture] },
      ]);
      mockGetStaleWeekItems.mockResolvedValue([]);
      mockGetPipeline.mockResolvedValue([]);

      const el = await RunwayPage();
      render(el);
      const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);

      const thisWeekDates = props.thisWeek.map((d: { date: string }) => d.date);
      expect(thisWeekDates).toContain("2026-05-15");
      // Note: strict-start In Flight exclusion (startDate == today → excluded
      // from In Flight) is exercised by plate-summary.test.ts, not here.
      // page.tsx hands the full inFlightSource through; InFlightSection
      // applies filterInFlight at render time.
    });

    // Test 3 — suppression-removal proven end-to-end (page-level wiring).
    // The queries-level test already covers the predicate; this asserts the
    // page hands the stale list through to RunwayBoard regardless of what
    // updates the project may have received.
    it("past-end L2 stays in staleItems even when its project has a recent update (suppression removed)", async () => {
      vi.setSystemTime(new Date("2026-04-28T12:00:00"));

      const overdueWithUpdate = {
        title: "Overdue with recent project update",
        account: "X",
        type: "delivery" as const,
        endDate: "2026-04-20",
        date: "2026-04-20",
        projectId: "p-X",
        status: "scheduled",
      };

      mockGetClientsWithProjects.mockResolvedValue([]);
      mockGetWeekItems.mockResolvedValue([]);
      mockGetStaleWeekItems.mockResolvedValue([
        { date: "2026-04-20", label: "Mon 4/20", items: [overdueWithUpdate] },
      ]);
      mockGetPipeline.mockResolvedValue([]);

      const el = await RunwayPage();
      render(el);
      const props = JSON.parse(screen.getByTestId("runway-board").getAttribute("data-props")!);

      const staleTitles = props.staleItems.flatMap(
        (d: { items: { title: string }[] }) => d.items.map((i) => i.title)
      );
      expect(staleTitles).toContain("Overdue with recent project update");
    });
  });
});
