/**
 * Tests for `loadEntityById` (Wave 7 / Fix 7.2).
 *
 * The interactivity-route tests (`@/app/api/slack/interactivity/route.test.ts`)
 * mock this module out, leaving its column-projection contract untested. If
 * the schema gains a new field that one of the modal builders consumes off
 * `currentValues` and `loadEntityById` does not project that column, the
 * modal silently misses the prefill. These tests pin the per-kind projected
 * column set so any drift is caught by the suite.
 *
 * The Wave 6 / Fix 6.11 column projection lock is asserted directly:
 *   - task: id, title, clientId, projectId, category, status, date, weekOf,
 *           startDate, endDate, dayOfWeek, blockedBy, owner, resources, notes
 *   - project: id, name, clientId, status, category, owner, resources,
 *              parentProjectId, engagementType, startDate, endDate,
 *              contractStart, contractEnd, dueDate, notes
 *   - team-member: id, name, fullName, roleCategory, isActive
 *
 * The "no email column on team_members" comment in load-entity-by-id.ts is
 * locked by an explicit negative assertion below.
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { getTableName } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Fixture rows. The columns mirror the runway-schema.ts shape; `loadEntityById`
// will project a subset (the lock under test).
// ---------------------------------------------------------------------------

const FIXTURE_PROJECTS = [
  {
    id: "proj_brand_refresh_xyz123",
    name: "Brand Refresh",
    clientId: "cli_ag1",
    status: "in-production",
    category: "active",
    owner: "Jason",
    resources: "AM: Sam, Dev: Lee",
    parentProjectId: null,
    engagementType: "project",
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    contractStart: null,
    contractEnd: null,
    dueDate: "2026-06-30",
    notes: "Project notes here",
    sortOrder: 0,
  },
];

const FIXTURE_WEEK_ITEMS = [
  {
    id: "wi_concept_writeup_full_id",
    title: "Concept Writeup",
    clientId: "cli_ag1",
    projectId: "proj_brand_refresh_xyz123",
    category: "delivery",
    status: "scheduled",
    date: "2026-04-15",
    weekOf: "2026-04-13",
    startDate: "2026-04-15",
    endDate: null,
    dayOfWeek: "wednesday",
    blockedBy: null,
    owner: "Sam",
    resources: "CW: Sam",
    notes: "Task notes here",
    sortOrder: 0,
  },
];

const FIXTURE_TEAM_MEMBERS = [
  {
    id: "tm_jason_full_ulid_xx_id_1",
    name: "Jason",
    firstName: "Jason",
    fullName: "Jason Burks",
    nicknames: null,
    title: "Founder",
    slackUserId: null,
    roleCategory: "leadership",
    accountsLed: null,
    channelPurpose: null,
    isActive: 1,
  },
];

// ---------------------------------------------------------------------------
// DB mock: chainable select() that dispatches by table identity (via
// getTableName, stable across vi.resetModules) and `where(eq(table.id, X))`.
// Mirrors the pattern from src/app/api/slack/commands/route.test.ts.
// ---------------------------------------------------------------------------

type MockState = {
  lastTable: unknown;
  whereFilter: ((row: Record<string, unknown>) => boolean) | null;
};

function makeDbMock() {
  const state: MockState = { lastTable: null, whereFilter: null };
  const tableRows = (t: unknown): Record<string, unknown>[] => {
    const name = (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return getTableName(t as any);
      } catch {
        return "";
      }
    })();
    if (name === "projects") return FIXTURE_PROJECTS as unknown as Record<string, unknown>[];
    if (name === "week_items") return FIXTURE_WEEK_ITEMS as unknown as Record<string, unknown>[];
    if (name === "team_members") return FIXTURE_TEAM_MEMBERS as unknown as Record<string, unknown>[];
    return [];
  };
  const exec = () => {
    const rows = tableRows(state.lastTable);
    if (!state.whereFilter) return rows;
    return rows.filter(state.whereFilter);
  };
  type SelectChain = {
    from: (t: unknown) => SelectChain;
    where: (filter: { _idMatch?: string }) => SelectChain;
    limit: () => Promise<Record<string, unknown>[]>;
  };
  const buildSelectChain = (cols: Record<string, unknown>): SelectChain => {
    const chain: SelectChain = {
      from(t: unknown) {
        state.lastTable = t;
        state.whereFilter = null;
        return chain;
      },
      where(filter) {
        if (filter._idMatch !== undefined) {
          const idMatch = filter._idMatch;
          state.whereFilter = (r) => r.id === idMatch;
        }
        return chain;
      },
      async limit() {
        // Project the requested column subset off the matched rows so the
        // returned shape mirrors what drizzle's typed select() produces.
        const rows = exec();
        const colKeys = Object.keys(cols);
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const k of colKeys) out[k] = r[k];
          return out;
        });
      },
    };
    return chain;
  };

  const db = {
    select: (cols: Record<string, unknown>) => buildSelectChain(cols),
  };
  return { db };
}

function setupMocks() {
  vi.resetModules();
  const { db } = makeDbMock();
  vi.doMock("@/lib/db/runway", () => ({
    getRunwayDb: () => db,
  }));
  // Make `eq(table.<col>, value)` produce a sentinel the mock select can
  // recognize (we narrow by id via _idMatch).
  vi.doMock("drizzle-orm", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
    return {
      ...actual,
      eq: (col: unknown, value: unknown) => ({ _idMatch: value, _col: col }),
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadEntityById - task kind", () => {
  beforeEach(() => {
    setupMocks();
  });

  it("returns the projected columns for a real week_item row", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("task", "wi_concept_writeup_full_id");
    expect(row).not.toBeNull();
    // Locked column projection (Wave 6 / Fix 6.11):
    expect(Object.keys(row as Record<string, unknown>).sort()).toEqual(
      [
        "blockedBy",
        "category",
        "clientId",
        "date",
        "dayOfWeek",
        "endDate",
        "id",
        "notes",
        "owner",
        "projectId",
        "resources",
        "startDate",
        "status",
        "title",
        "weekOf",
      ].sort(),
    );
    // Pin the primary identifying field (consumed by buildTaskModal as
    // currentValues.title).
    expect((row as Record<string, unknown>).title).toBe("Concept Writeup");
    expect((row as Record<string, unknown>).id).toBe("wi_concept_writeup_full_id");
  });

  it("returns null when id has no matching row", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("task", "wi_does_not_exist");
    expect(row).toBeNull();
  });

  it("returns null for empty-string id", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("task", "");
    expect(row).toBeNull();
  });
});

describe("loadEntityById - project kind", () => {
  beforeEach(() => {
    setupMocks();
  });

  it("returns the projected columns for a real project row", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("project", "proj_brand_refresh_xyz123");
    expect(row).not.toBeNull();
    expect(Object.keys(row as Record<string, unknown>).sort()).toEqual(
      [
        "category",
        "clientId",
        "contractEnd",
        "contractStart",
        "dueDate",
        "endDate",
        "engagementType",
        "id",
        "name",
        "notes",
        "owner",
        "parentProjectId",
        "resources",
        "startDate",
        "status",
      ].sort(),
    );
    // Pin the primary identifying field (consumed by buildProjectModal as
    // currentValues.name).
    expect((row as Record<string, unknown>).name).toBe("Brand Refresh");
    expect((row as Record<string, unknown>).id).toBe("proj_brand_refresh_xyz123");
  });

  it("returns null when id has no matching row", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("project", "proj_does_not_exist");
    expect(row).toBeNull();
  });

  it("returns null for empty-string id", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("project", "");
    expect(row).toBeNull();
  });

  it("does not bleed sortOrder, createdAt, updatedAt, waitingOn, staleDays into the row", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = (await loadEntityById(
      "project",
      "proj_brand_refresh_xyz123",
    )) as Record<string, unknown>;
    expect(row).not.toHaveProperty("sortOrder");
    expect(row).not.toHaveProperty("createdAt");
    expect(row).not.toHaveProperty("updatedAt");
    expect(row).not.toHaveProperty("waitingOn");
    expect(row).not.toHaveProperty("staleDays");
  });
});

describe("loadEntityById - team-member kind", () => {
  beforeEach(() => {
    setupMocks();
  });

  it("returns the projected columns for a real team_member row", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("team-member", "tm_jason_full_ulid_xx_id_1");
    expect(row).not.toBeNull();
    expect(Object.keys(row as Record<string, unknown>).sort()).toEqual(
      ["fullName", "id", "isActive", "name", "roleCategory"].sort(),
    );
    // Pin the primary identifying fields (buildTeamMemberModal reads
    // currentValues.fullName ?? currentValues.name).
    expect((row as Record<string, unknown>).fullName).toBe("Jason Burks");
    expect((row as Record<string, unknown>).name).toBe("Jason");
    expect((row as Record<string, unknown>).id).toBe("tm_jason_full_ulid_xx_id_1");
  });

  it("explicitly does NOT return an `email` field (locks the schema-truth comment)", async () => {
    // load-entity-by-id.ts line 95-99: "email is not a column on the
    // teamMembers table in runway-schema.ts - the modal pre-fill reads
    // currentValues.email but the schema has no matching column today,
    // so we omit it from the projection."
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("team-member", "tm_jason_full_ulid_xx_id_1");
    expect(row).not.toBeNull();
    expect(row).not.toHaveProperty("email");
  });

  it("returns null when id has no matching row", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("team-member", "tm_does_not_exist");
    expect(row).toBeNull();
  });

  it("returns null for empty-string id", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("team-member", "");
    expect(row).toBeNull();
  });
});

describe("loadEntityById - cross-kind id miss", () => {
  beforeEach(() => {
    setupMocks();
  });

  it("returns null when querying task kind with a project id (wrong kind)", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("task", "proj_brand_refresh_xyz123");
    expect(row).toBeNull();
  });

  it("returns null when querying project kind with a week_item id (wrong kind)", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById("project", "wi_concept_writeup_full_id");
    expect(row).toBeNull();
  });

  it("returns null when querying team-member kind with a project id (wrong kind)", async () => {
    const { loadEntityById } = await import("./load-entity-by-id");
    const row = await loadEntityById(
      "team-member",
      "proj_brand_refresh_xyz123",
    );
    expect(row).toBeNull();
  });
});
