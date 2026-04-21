/**
 * Tests for getProjectStatus — project drill-down contract.
 *
 * Contract consumed by Chunk 3 UI + bot drill-down response layer.
 * Do not change shape without updating both downstream consumers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock schema tables referenced by import identity ────────
import { projects, weekItems, updates, clients } from "@/lib/db/runway-schema";

// Per-test mock state
const mockGetRunwayDb = vi.fn();

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => mockGetRunwayDb(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
  asc: vi.fn((col) => ({ asc: col })),
  desc: vi.fn((col) => ({ desc: col })),
}));

// Mock the fuzzy lookup helpers used by getProjectStatus.
const mockClient = { id: "c1", name: "Convergix", slug: "convergix", team: "AM: Allie, CD: Lane, Dev: Leslie", contractStatus: "signed" };
let mockProjectRow: Record<string, unknown> | null = null;

vi.mock("./operations-utils", () => ({
  getClientOrFail: async (slug: string) => {
    if (slug === "notfound") return { ok: false, error: "Client 'notfound' not found." };
    return { ok: true, client: mockClient };
  },
  resolveProjectOrFail: async () => {
    if (!mockProjectRow) return { ok: false, error: "Project not found.", available: [] };
    return { ok: true, project: mockProjectRow };
  },
}));

vi.mock("./operations-reads-week", () => ({
  chicagoISODate: (d: Date) => {
    // Lightweight stand-in: align with production behavior for 2026-04-20 UTC noon.
    return d.toISOString().slice(0, 10);
  },
}));

// Helpers — build a db mock that routes by table identity.
function mockDbRoutes(routes: {
  weekItems?: Record<string, unknown>[];
  updates?: Record<string, unknown>[];
  clientRow?: Record<string, unknown> | null;
}) {
  const mkSelectFrom = (table: unknown) => {
    const rows =
      table === weekItems
        ? routes.weekItems ?? []
        : table === updates
          ? routes.updates ?? []
          : table === clients
            ? (routes.clientRow ? [routes.clientRow] : [])
            : table === projects
              ? []
              : [];

    // Chainable: where().orderBy() or where().orderBy().limit()
    const chain: Record<string, unknown> = {
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      get: vi.fn(() => rows[0]),
      then: (resolve: (v: unknown) => void) => resolve(rows),
    };
    return chain;
  };

  const db = {
    select: vi.fn(() => ({ from: vi.fn((table: unknown) => mkSelectFrom(table)) })),
  };
  mockGetRunwayDb.mockReturnValue(db);
  return db;
}

function mkProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    clientId: "c1",
    name: "CDS Messaging",
    status: "in-production",
    category: "active",
    owner: "Kathy",
    resources: "CD: Lane",
    waitingOn: null,
    target: null,
    dueDate: null,
    startDate: "2026-04-01",
    endDate: "2026-05-01",
    contractStart: null,
    contractEnd: null,
    engagementType: "project",
    notes: null,
    staleDays: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mkWeekItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    projectId: "p1",
    clientId: "c1",
    dayOfWeek: "monday",
    weekOf: "2026-04-20",
    date: "2026-04-20",
    startDate: "2026-04-20",
    endDate: null,
    blockedBy: null,
    title: "Some milestone",
    status: null,
    category: "review",
    owner: null,
    resources: null,
    notes: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mkUpdate(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    idempotencyKey: "k1",
    projectId: "p1",
    clientId: "c1",
    updatedBy: "kathy",
    updateType: "status-change",
    previousValue: "not-started",
    newValue: "in-production",
    summary: "Convergix / CDS Messaging: not-started -> in-production",
    metadata: null,
    batchId: null,
    triggeredByUpdateId: null,
    slackMessageTs: null,
    createdAt: new Date("2026-04-20T12:00:00Z"),
    ...overrides,
  };
}

// Noon UTC on 2026-04-20 → slice(0,10) === "2026-04-20" via mock.
const NOW = new Date("2026-04-20T12:00:00Z");

describe("getProjectStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectRow = null;
  });

  it("returns ok:false when the client is not found", async () => {
    const { getProjectStatus } = await import("./operations-reads-project-status");
    const result = await getProjectStatus({
      clientSlug: "notfound",
      projectName: "whatever",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/);
  });

  it("returns ok:false with available list when the project is not found", async () => {
    mockProjectRow = null;
    mockDbRoutes({});
    const { getProjectStatus } = await import("./operations-reads-project-status");
    const result = await getProjectStatus({
      clientSlug: "convergix",
      projectName: "missing",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("returns the full ProjectStatus shape for a basic engagement", async () => {
    mockProjectRow = mkProject();
    mockDbRoutes({
      weekItems: [
        mkWeekItem({ id: "w-in-flight", title: "Discovery", status: "in-progress", startDate: "2026-04-18", endDate: "2026-04-25" }),
        mkWeekItem({ id: "w-soon", title: "Review", status: null, startDate: "2026-04-30" }),
        mkWeekItem({ id: "w-far", title: "Launch", status: null, startDate: "2026-05-15" }),
      ],
      updates: [mkUpdate()],
      clientRow: { id: "c1", team: "AM: Allie, CD: Lane, Dev: Leslie" },
    });

    const { getProjectStatus } = await import("./operations-reads-project-status");
    const result = await getProjectStatus({
      clientSlug: "convergix",
      projectName: "CDS Messaging",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = result.status;
    expect(s.name).toBe("CDS Messaging");
    expect(s.client).toBe("Convergix");
    expect(s.owner).toBe("Kathy");
    expect(s.status).toBe("in-production");
    expect(s.engagement_type).toBe("project");
    expect(s.contractRange).toEqual({ start: "2026-04-01", end: "2026-05-01" });
    expect(s.inFlight.map((i) => i.id)).toEqual(["w-in-flight"]);
    expect(s.upcoming.map((i) => i.id)).toEqual(["w-soon"]); // w-far is >14 days out
    expect(s.team).toBe("AM: Allie, CD: Lane, Dev: Leslie");
    expect(s.recentUpdates).toHaveLength(1);
    expect(s.recentUpdates[0].id).toBe("u1");
  });

  it("sorts upcoming by startDate ASC", async () => {
    mockProjectRow = mkProject();
    mockDbRoutes({
      weekItems: [
        mkWeekItem({ id: "w-later", startDate: "2026-04-28", status: null }),
        mkWeekItem({ id: "w-sooner", startDate: "2026-04-22", status: null }),
      ],
      updates: [],
      clientRow: { id: "c1", team: "" },
    });
    const { getProjectStatus } = await import("./operations-reads-project-status");
    const r = await getProjectStatus({ clientSlug: "convergix", projectName: "X", now: NOW });
    if (!r.ok) throw new Error("expected ok");
    expect(r.status.upcoming.map((i) => i.id)).toEqual(["w-sooner", "w-later"]);
  });

  it("excludes completed L2s from in-flight and upcoming", async () => {
    mockProjectRow = mkProject();
    mockDbRoutes({
      weekItems: [
        mkWeekItem({ id: "w-done", status: "completed", startDate: "2026-04-22" }),
        mkWeekItem({ id: "w-current", status: "in-progress", startDate: "2026-04-20", endDate: "2026-04-25" }),
      ],
      updates: [],
      clientRow: { id: "c1", team: "" },
    });
    const { getProjectStatus } = await import("./operations-reads-project-status");
    const r = await getProjectStatus({ clientSlug: "convergix", projectName: "X", now: NOW });
    if (!r.ok) throw new Error("expected ok");
    expect(r.status.inFlight.map((i) => i.id)).toEqual(["w-current"]);
    expect(r.status.upcoming.map((i) => i.id)).toEqual([]);
  });

  it("populates blockers from status=blocked L2s and blocked_by references", async () => {
    mockProjectRow = mkProject();
    mockDbRoutes({
      weekItems: [
        mkWeekItem({ id: "w-up", title: "Upstream", status: null, startDate: "2026-04-15" }),
        mkWeekItem({ id: "w-blocked", title: "Waiting", status: "blocked", startDate: "2026-04-21", blockedBy: JSON.stringify(["w-up"]) }),
      ],
      updates: [],
      clientRow: { id: "c1", team: "" },
    });
    const { getProjectStatus } = await import("./operations-reads-project-status");
    const r = await getProjectStatus({ clientSlug: "convergix", projectName: "X", now: NOW });
    if (!r.ok) throw new Error("expected ok");
    // Blocked-status titles come first, then resolved blocked_by references.
    expect(r.status.current.blockers).toEqual(["Waiting", "Upstream"]);
  });

  it("logs a warning on malformed blocked_by JSON without failing the read", async () => {
    // Chunk 5 debt §12.3: surface malformed payloads instead of silently
    // swallowing the parse error.
    mockProjectRow = mkProject();
    mockDbRoutes({
      weekItems: [
        mkWeekItem({ id: "w-broken", title: "Broken", status: "blocked", startDate: "2026-04-21", blockedBy: "not-valid-json{" }),
      ],
      updates: [],
      clientRow: { id: "c1", team: "" },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { getProjectStatus } = await import("./operations-reads-project-status");
      const r = await getProjectStatus({ clientSlug: "convergix", projectName: "X", now: NOW });
      if (!r.ok) throw new Error("expected ok");
      // Read still returns successfully; only blocked-status title surfaces.
      expect(r.status.current.blockers).toEqual(["Broken"]);
      // Warning logged with the event tag for debugging visibility.
      expect(warnSpy).toHaveBeenCalled();
      const payload = JSON.parse(String(warnSpy.mock.calls[0][0]));
      expect(payload.event).toBe("runway_blocked_by_parse_error");
      expect(payload.weekItemId).toBe("w-broken");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("suggests review when an in-progress L2 is past its end_date", async () => {
    mockProjectRow = mkProject();
    mockDbRoutes({
      weekItems: [
        mkWeekItem({ id: "w-late", title: "Overdue", status: "in-progress", startDate: "2026-04-10", endDate: "2026-04-15" }),
      ],
      updates: [],
      clientRow: { id: "c1", team: "" },
    });
    const { getProjectStatus } = await import("./operations-reads-project-status");
    const r = await getProjectStatus({ clientSlug: "convergix", projectName: "X", now: NOW });
    if (!r.ok) throw new Error("expected ok");
    expect(r.status.suggestedActions).toContain(
      'review status on "Overdue" — past end_date with status still in-progress'
    );
  });

  it("suggests unblocking for blocked L2s", async () => {
    mockProjectRow = mkProject();
    mockDbRoutes({
      weekItems: [mkWeekItem({ title: "Stuck", status: "blocked" })],
      updates: [],
      clientRow: { id: "c1", team: "" },
    });
    const { getProjectStatus } = await import("./operations-reads-project-status");
    const r = await getProjectStatus({ clientSlug: "convergix", projectName: "X", now: NOW });
    if (!r.ok) throw new Error("expected ok");
    expect(r.status.suggestedActions).toContain('unblock "Stuck" (currently blocked)');
  });

  it("suggests retainer renewal when within 30 days of contract_end", async () => {
    mockProjectRow = mkProject({
      engagementType: "retainer",
      contractEnd: "2026-05-05", // 15 days from NOW (2026-04-20)
    });
    mockDbRoutes({
      weekItems: [],
      updates: [],
      clientRow: { id: "c1", team: "" },
    });
    const { getProjectStatus } = await import("./operations-reads-project-status");
    const r = await getProjectStatus({ clientSlug: "convergix", projectName: "X", now: NOW });
    if (!r.ok) throw new Error("expected ok");
    expect(
      r.status.suggestedActions.some((a) => a.includes("retainer renewal due"))
    ).toBe(true);
  });

  it("prefers contract_start / contract_end over derived start/end in contractRange", async () => {
    mockProjectRow = mkProject({
      startDate: "2026-04-01",
      endDate: "2026-05-01",
      contractStart: "2026-01-01",
      contractEnd: "2026-12-31",
    });
    mockDbRoutes({ weekItems: [], updates: [], clientRow: { id: "c1", team: "" } });
    const { getProjectStatus } = await import("./operations-reads-project-status");
    const r = await getProjectStatus({ clientSlug: "convergix", projectName: "X", now: NOW });
    if (!r.ok) throw new Error("expected ok");
    expect(r.status.contractRange).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });

  it("falls back to project.resources when clients.team is empty", async () => {
    mockProjectRow = mkProject({ resources: "CD: Lane only" });
    mockDbRoutes({ weekItems: [], updates: [], clientRow: { id: "c1", team: null } });
    const { getProjectStatus } = await import("./operations-reads-project-status");
    const r = await getProjectStatus({ clientSlug: "convergix", projectName: "X", now: NOW });
    if (!r.ok) throw new Error("expected ok");
    expect(r.status.team).toBe("CD: Lane only");
  });
});
