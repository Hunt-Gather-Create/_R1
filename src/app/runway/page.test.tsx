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

  // Exclusivity: items appearing in BOTH Needs Update (stale) AND In Flight
  // (in-progress + today inside [start, end]) must render only in Needs Update.
  // Real pre-fix examples on prod: Bonterra "Impact Report — Dev IR Revisions",
  // Soundly "Payment Gateway Page — In Dev". Stale wins because it's the action
  // signal — once the item is updated, it drops from stale and reappears in
  // In Flight on the next render.
  it("excludes items from inFlightSource when their projectId appears in staleItems (stale wins)", async () => {
    vi.setSystemTime(new Date("2026-04-27T12:00:00"));

    const collidingProjectId = "p-bonterra-ir";
    const staleDay = {
      date: "2026-04-20",
      label: "Mon 4/20",
      items: [{
        title: "Impact Report — Dev IR Revisions",
        account: "Bonterra",
        type: "delivery" as const,
        projectId: collidingProjectId,
      }],
    };
    const inFlightDay = {
      date: "2026-04-27",
      label: "Mon 4/27",
      items: [
        {
          title: "Impact Report — Dev IR Revisions",
          account: "Bonterra",
          type: "delivery" as const,
          projectId: collidingProjectId,
          status: "in-progress",
          startDate: "2026-04-20",
          endDate: "2026-05-31",
        },
        {
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
});
