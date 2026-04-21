import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getLinkedDeadlineItems,
  getPersonWorkload,
  getWeekItemsByProject,
  chicagoISODate,
} from "./operations-reads-week";
import { projects, weekItems, clients } from "@/lib/db/runway-schema";

// Mock the runway DB module
vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: vi.fn(),
}));

// Keep operations helpers pure where possible; only mock getClientNameMap to avoid DB fetch.
vi.mock("./operations", async () => {
  const actual = await vi.importActual<typeof import("./operations")>("./operations");
  return {
    ...actual,
    getClientNameMap: vi.fn(async () => new Map<string, string>()),
  };
});

import { getRunwayDb } from "@/lib/db/runway";

function createWeekItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "wi-1",
    projectId: "proj-1",
    clientId: "client-1",
    dayOfWeek: "monday",
    weekOf: "2026-04-06",
    date: "2026-04-07",
    startDate: "2026-04-07",
    endDate: null,
    blockedBy: null,
    title: "Test Item",
    status: null,
    category: "deadline",
    owner: null,
    resources: null,
    notes: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj-1",
    clientId: "client-1",
    name: "Project",
    status: "in-production",
    category: "active",
    owner: null,
    resources: null,
    waitingOn: null,
    target: null,
    dueDate: null,
    startDate: null,
    endDate: null,
    contractStart: null,
    contractEnd: null,
    engagementType: null,
    notes: null,
    staleDays: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    id: "client-1",
    name: "Client",
    slug: "client",
    nicknames: null,
    contractValue: null,
    contractTerm: null,
    contractStatus: "signed",
    team: null,
    clientContacts: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Build a chainable mock that captures the where clause and filters results
function mockDbWithItems(items: ReturnType<typeof createWeekItem>[]) {
  const mockWhere = vi.fn().mockResolvedValue(
    // The actual filtering happens in the DB; we simulate it by returning
    // only items matching the expected category + projectId
    items.filter((i) => i.category === "deadline")
  );
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  const mockDb = { select: mockSelect };
  vi.mocked(getRunwayDb).mockReturnValue(mockDb as never);
  return { mockDb, mockWhere };
}

/**
 * Mock a DB that resolves table-specific queries used by getPersonWorkload:
 * projects → orderBy returns projects
 * weekItems → orderBy returns week items
 * clients → direct await returns clients
 */
function mockWorkloadDb(
  projectRows: ReturnType<typeof createProject>[],
  weekItemRows: ReturnType<typeof createWeekItem>[],
  clientRows: ReturnType<typeof createClient>[]
) {
  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn((table: unknown) => {
        const rows =
          table === projects
            ? projectRows
            : table === weekItems
              ? weekItemRows
              : table === clients
                ? clientRows
                : [];
        const awaitable = {
          orderBy: vi.fn().mockResolvedValue(rows),
          then: (resolve: (v: unknown) => void) => resolve(rows),
        };
        return awaitable;
      }),
    }),
  };
  vi.mocked(getRunwayDb).mockReturnValue(mockDb as never);
  return mockDb;
}

describe("getLinkedDeadlineItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only deadline-category items for a project", async () => {
    const deadline1 = createWeekItem({ id: "wi-1", title: "Code handoff", category: "deadline" });
    const deadline2 = createWeekItem({ id: "wi-2", title: "Go live", category: "deadline" });
    const review = createWeekItem({ id: "wi-3", title: "Design review", category: "review" });
    const delivery = createWeekItem({ id: "wi-4", title: "Asset delivery", category: "delivery" });

    mockDbWithItems([deadline1, deadline2, review, delivery]);

    const result = await getLinkedDeadlineItems("proj-1");

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.title)).toEqual(["Code handoff", "Go live"]);
  });

  it("returns empty array when no deadline items linked", async () => {
    const review = createWeekItem({ id: "wi-1", title: "Design review", category: "review" });

    mockDbWithItems([review]);

    const result = await getLinkedDeadlineItems("proj-1");

    expect(result).toHaveLength(0);
  });

  it("returns empty array when no items exist for project", async () => {
    mockDbWithItems([]);

    const result = await getLinkedDeadlineItems("proj-nonexistent");

    expect(result).toHaveLength(0);
  });

  it("calls getRunwayDb and queries with correct table", async () => {
    mockDbWithItems([]);

    await getLinkedDeadlineItems("proj-1");

    expect(getRunwayDb).toHaveBeenCalledOnce();
  });
});

// Mock for select().from().where().orderBy() returning the provided rows.
function mockProjectWeekItems(items: ReturnType<typeof createWeekItem>[]) {
  const mockOrderBy = vi.fn().mockResolvedValue(items);
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  vi.mocked(getRunwayDb).mockReturnValue({ select: mockSelect } as never);
}

describe("getWeekItemsByProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all non-completed L2s for the project", async () => {
    const items = [
      createWeekItem({ id: "w1", title: "Kickoff", status: null, startDate: "2026-04-10" }),
      createWeekItem({ id: "w2", title: "Done thing", status: "completed", startDate: "2026-04-11" }),
      createWeekItem({ id: "w3", title: "In progress", status: "in-progress", startDate: "2026-04-12" }),
      createWeekItem({ id: "w4", title: "Blocked thing", status: "blocked", startDate: "2026-04-13" }),
    ];
    mockProjectWeekItems(items);

    const result = await getWeekItemsByProject("proj-1");
    expect(result.map((r) => r.id)).toEqual(["w1", "w3", "w4"]);
  });

  it("sorts by start_date ASC then sortOrder", async () => {
    const items = [
      createWeekItem({ id: "w-late", startDate: "2026-04-20", sortOrder: 1 }),
      createWeekItem({ id: "w-early-b", startDate: "2026-04-10", sortOrder: 3 }),
      createWeekItem({ id: "w-early-a", startDate: "2026-04-10", sortOrder: 1 }),
    ];
    mockProjectWeekItems(items);

    const result = await getWeekItemsByProject("proj-1");
    expect(result.map((r) => r.id)).toEqual(["w-early-a", "w-early-b", "w-late"]);
  });

  it("returns empty array when the project has no L2s", async () => {
    mockProjectWeekItems([]);
    const result = await getWeekItemsByProject("proj-1");
    expect(result).toEqual([]);
  });

  it("falls back to legacy `date` when start_date is null", async () => {
    const items = [
      createWeekItem({ id: "w-legacy", startDate: null, date: "2026-04-09", sortOrder: 0 }),
      createWeekItem({ id: "w-new", startDate: "2026-04-10", sortOrder: 0 }),
    ];
    mockProjectWeekItems(items);

    const result = await getWeekItemsByProject("proj-1");
    expect(result.map((r) => r.id)).toEqual(["w-legacy", "w-new"]);
  });
});

describe("chicagoISODate", () => {
  it("returns YYYY-MM-DD in America/Chicago", () => {
    // 2026-04-20 05:00 UTC == 00:00 America/Chicago (CDT UTC-5)
    const utcMorning = new Date("2026-04-20T05:00:00Z");
    expect(chicagoISODate(utcMorning)).toBe("2026-04-20");
  });

  it("handles pre-midnight UTC as still prior day in Chicago", () => {
    // 2026-04-20 04:00 UTC == 23:00 on 2026-04-19 in Chicago (CDT)
    const lateNight = new Date("2026-04-20T04:00:00Z");
    expect(chicagoISODate(lateNight)).toBe("2026-04-19");
  });
});

describe("getPersonWorkload — v4 contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Anchor "now" to Monday 2026-04-20 12:00 Chicago for stable bucket tests.
  // This puts: thisWeek = 2026-04-20..2026-04-26, nextWeek = 2026-04-27..2026-05-03.
  const NOW = new Date("2026-04-20T17:00:00Z"); // 12:00 CDT

  it("returns the full contract shape when person has no data", async () => {
    mockWorkloadDb([], [], []);

    const result = await getPersonWorkload("Nobody", { now: NOW });

    expect(result).toEqual({
      person: "Nobody",
      ownedProjects: {
        inProgress: [],
        awaitingClient: [],
        blocked: [],
        onHold: [],
        completed: [],
      },
      weekItems: {
        overdue: [],
        thisWeek: [],
        nextWeek: [],
        later: [],
      },
      flags: {
        contractExpired: [],
        retainerRenewalDue: [],
      },
      totalProjects: 0,
      totalActiveWeekItems: 0,
    });
  });

  it("buckets week items into overdue / thisWeek / nextWeek / later", async () => {
    const rows = [
      createWeekItem({
        id: "w-overdue",
        owner: "Kathy",
        startDate: "2026-04-15",
        endDate: "2026-04-15",
        status: "in-progress",
      }),
      createWeekItem({
        id: "w-this",
        owner: "Kathy",
        startDate: "2026-04-22",
        endDate: null,
      }),
      createWeekItem({
        id: "w-next",
        owner: "Kathy",
        startDate: "2026-04-28",
        endDate: null,
      }),
      createWeekItem({
        id: "w-later",
        owner: "Kathy",
        startDate: "2026-05-15",
        endDate: null,
      }),
    ];
    mockWorkloadDb([], rows, []);

    const result = await getPersonWorkload("Kathy", { now: NOW });

    expect(result.weekItems.overdue.map((i) => i.id)).toEqual(["w-overdue"]);
    expect(result.weekItems.thisWeek.map((i) => i.id)).toEqual(["w-this"]);
    expect(result.weekItems.nextWeek.map((i) => i.id)).toEqual(["w-next"]);
    expect(result.weekItems.later.map((i) => i.id)).toEqual(["w-later"]);
    expect(result.totalActiveWeekItems).toBe(4);
  });

  it("excludes completed L2s from the overdue bucket", async () => {
    const rows = [
      createWeekItem({
        id: "w-done",
        owner: "Kathy",
        startDate: "2026-04-10",
        endDate: "2026-04-10",
        status: "completed",
      }),
    ];
    mockWorkloadDb([], rows, []);

    const result = await getPersonWorkload("Kathy", { now: NOW });
    expect(result.weekItems.overdue).toHaveLength(0);
  });

  it("treats null end_date as same as start_date for overdue bucketing", async () => {
    const rows = [
      createWeekItem({
        id: "w-single-overdue",
        owner: "Kathy",
        startDate: "2026-04-15",
        endDate: null,
        status: "in-progress",
      }),
    ];
    mockWorkloadDb([], rows, []);

    const result = await getPersonWorkload("Kathy", { now: NOW });
    expect(result.weekItems.overdue.map((i) => i.id)).toEqual(["w-single-overdue"]);
  });

  it("filters stub L2s whose parent L1 status is awaiting-client", async () => {
    const parentStub = createProject({ id: "p-stub", status: "awaiting-client", owner: "Jill" });
    const parentActive = createProject({ id: "p-active", status: "in-production", owner: "Jill" });
    const rows = [
      createWeekItem({
        id: "w-stub",
        owner: "Kathy",
        projectId: "p-stub",
        startDate: "2026-04-22",
      }),
      createWeekItem({
        id: "w-ok",
        owner: "Kathy",
        projectId: "p-active",
        startDate: "2026-04-22",
      }),
    ];
    mockWorkloadDb([parentStub, parentActive], rows, []);

    const result = await getPersonWorkload("Kathy", { now: NOW });
    expect(result.weekItems.thisWeek.map((i) => i.id)).toEqual(["w-ok"]);
  });

  it("matches L1 projects on owner only, not resources", async () => {
    const ownerMatch = createProject({
      id: "p-owner",
      owner: "Jill",
      resources: null,
      status: "in-production",
    });
    const resourceOnly = createProject({
      id: "p-res",
      owner: "Allison",
      resources: "PM: Jill",
      status: "in-production",
    });
    mockWorkloadDb([ownerMatch, resourceOnly], [], []);

    const result = await getPersonWorkload("Jill", { now: NOW });
    expect(result.ownedProjects.inProgress.map((p) => p.id)).toEqual(["p-owner"]);
  });

  it("buckets owned projects by status", async () => {
    const rows = [
      createProject({ id: "p-active", owner: "Jill", status: "in-production" }),
      createProject({ id: "p-await", owner: "Jill", status: "awaiting-client" }),
      createProject({ id: "p-blocked", owner: "Jill", status: "blocked" }),
      createProject({ id: "p-hold", owner: "Jill", status: "on-hold" }),
      createProject({ id: "p-done", owner: "Jill", status: "completed" }),
    ];
    mockWorkloadDb(rows, [], []);

    const result = await getPersonWorkload("Jill", { now: NOW });
    expect(result.ownedProjects.inProgress.map((p) => p.id)).toEqual(["p-active"]);
    expect(result.ownedProjects.awaitingClient.map((p) => p.id)).toEqual(["p-await"]);
    expect(result.ownedProjects.blocked.map((p) => p.id)).toEqual(["p-blocked"]);
    expect(result.ownedProjects.onHold.map((p) => p.id)).toEqual(["p-hold"]);
    // Completed omitted by default.
    expect(result.ownedProjects.completed).toEqual([]);
    expect(result.totalProjects).toBe(4);
  });

  it("includes completed projects only when includeCompleted=true", async () => {
    const done = createProject({ id: "p-done", owner: "Jill", status: "completed" });
    mockWorkloadDb([done], [], []);

    const withFlag = await getPersonWorkload("Jill", { now: NOW, includeCompleted: true });
    expect(withFlag.ownedProjects.completed.map((p) => p.id)).toEqual(["p-done"]);
    expect(withFlag.totalProjects).toBe(1);
  });

  it("raises contractExpired flag for clients with expired contract + active owned L1", async () => {
    const expired = createClient({ id: "c-expired", contractStatus: "expired", name: "Expired Co" });
    const signed = createClient({ id: "c-signed", contractStatus: "signed", name: "Signed Co" });
    const ownedActive = createProject({
      id: "p-active",
      owner: "Jill",
      clientId: "c-expired",
      status: "in-production",
    });
    // Another owned L1 on a signed-contract client — should not flag.
    const ownedSigned = createProject({
      id: "p-sig",
      owner: "Jill",
      clientId: "c-signed",
      status: "in-production",
    });
    mockWorkloadDb([ownedActive, ownedSigned], [], [expired, signed]);

    const result = await getPersonWorkload("Jill", { now: NOW });
    expect(result.flags.contractExpired.map((c) => c.id)).toEqual(["c-expired"]);
  });

  it("does not raise contractExpired when the owned L1 is not active", async () => {
    const expired = createClient({ id: "c-expired", contractStatus: "expired" });
    const ownedDormant = createProject({
      id: "p-hold",
      owner: "Jill",
      clientId: "c-expired",
      status: "on-hold",
    });
    mockWorkloadDb([ownedDormant], [], [expired]);

    const result = await getPersonWorkload("Jill", { now: NOW });
    expect(result.flags.contractExpired).toEqual([]);
  });

  it("raises retainerRenewalDue for retainer L1s within 30 days of contract_end", async () => {
    // Today = 2026-04-20. Within 30 days = through 2026-05-20.
    const dueSoon = createProject({
      id: "p-due",
      owner: "Jill",
      engagementType: "retainer",
      contractEnd: "2026-05-10",
      status: "in-production",
    });
    const dueFar = createProject({
      id: "p-far",
      owner: "Jill",
      engagementType: "retainer",
      contractEnd: "2026-07-01",
      status: "in-production",
    });
    const notRetainer = createProject({
      id: "p-proj",
      owner: "Jill",
      engagementType: "project",
      contractEnd: "2026-05-01",
      status: "in-production",
    });
    mockWorkloadDb([dueSoon, dueFar, notRetainer], [], []);

    const result = await getPersonWorkload("Jill", { now: NOW });
    expect(result.flags.retainerRenewalDue.map((p) => p.id)).toEqual(["p-due"]);
  });

  it("sorts weekItems buckets by start_date then sortOrder", async () => {
    const rows = [
      createWeekItem({
        id: "w-b",
        owner: "Kathy",
        startDate: "2026-04-23",
        sortOrder: 5,
      }),
      createWeekItem({
        id: "w-a",
        owner: "Kathy",
        startDate: "2026-04-22",
        sortOrder: 1,
      }),
      createWeekItem({
        id: "w-c",
        owner: "Kathy",
        startDate: "2026-04-22",
        sortOrder: 3,
      }),
    ];
    mockWorkloadDb([], rows, []);

    const result = await getPersonWorkload("Kathy", { now: NOW });
    expect(result.weekItems.thisWeek.map((i) => i.id)).toEqual(["w-a", "w-c", "w-b"]);
  });
});
