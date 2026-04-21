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
});
