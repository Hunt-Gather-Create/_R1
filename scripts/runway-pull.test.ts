import { describe, it, expect } from "vitest";
import { buildSnapshot, diffSnapshots, validateSnapshot } from "./runway-pull";

describe("buildSnapshot", () => {
  it("produces valid structure with tables and metadata", () => {
    const tables = {
      clients: [{ id: "c1", name: "Convergix", slug: "convergix" }],
      projects: [],
      weekItems: [],
      pipelineItems: [],
      updates: [],
      teamMembers: [],
    };
    const snapshot = buildSnapshot(tables, "file:test.db");
    expect(snapshot.source).toBe("file:test.db");
    expect(snapshot.pulledAt).toBeDefined();
    expect(snapshot.tables.clients).toHaveLength(1);
    expect(snapshot.tables.clients[0].name).toBe("Convergix");
    expect(snapshot.tables.projects).toEqual([]);
  });

  it("handles single-table snapshot with empty arrays for other tables", () => {
    const tables = {
      clients: [{ id: "c1", name: "Convergix" }],
      projects: [],
      weekItems: [],
      pipelineItems: [],
      updates: [],
      teamMembers: [],
    };
    const snapshot = buildSnapshot(tables, "file:test.db");
    expect(snapshot.tables.clients).toHaveLength(1);
    expect(snapshot.tables.projects).toEqual([]);
    expect(snapshot.tables.weekItems).toEqual([]);
    expect(snapshot.tables.pipelineItems).toEqual([]);
    expect(snapshot.tables.updates).toEqual([]);
    expect(snapshot.tables.teamMembers).toEqual([]);
  });
});

describe("diffSnapshots", () => {
  const base = {
    pulledAt: "2026-04-14T10:00:00Z",
    source: "file:test.db",
    tables: {
      clients: [
        { id: "c1", name: "Convergix", slug: "convergix" },
        { id: "c2", name: "LPPC", slug: "lppc" },
      ],
      projects: [{ id: "p1", name: "CDS", clientId: "c1" }],
      weekItems: [],
      pipelineItems: [],
      updates: [],
      teamMembers: [{ id: "t1", name: "Kathy Horn" }],
    },
  };

  it("detects added rows", () => {
    const newer = {
      ...base,
      pulledAt: "2026-04-14T12:00:00Z",
      tables: {
        ...base.tables,
        clients: [
          ...base.tables.clients,
          { id: "c3", name: "Soundly", slug: "soundly" },
        ],
      },
    };
    const diff = diffSnapshots(base, newer);
    expect(diff.clients.added).toHaveLength(1);
    expect(diff.clients.added[0].id).toBe("c3");
    expect(diff.clients.removed).toHaveLength(0);
    expect(diff.clients.changed).toHaveLength(0);
  });

  it("detects removed rows", () => {
    const newer = {
      ...base,
      pulledAt: "2026-04-14T12:00:00Z",
      tables: {
        ...base.tables,
        clients: [{ id: "c1", name: "Convergix", slug: "convergix" }],
      },
    };
    const diff = diffSnapshots(base, newer);
    expect(diff.clients.removed).toHaveLength(1);
    expect(diff.clients.removed[0].id).toBe("c2");
  });

  it("detects changed fields", () => {
    const newer = {
      ...base,
      pulledAt: "2026-04-14T12:00:00Z",
      tables: {
        ...base.tables,
        clients: [
          { id: "c1", name: "Convergix Industries", slug: "convergix" },
          { id: "c2", name: "LPPC", slug: "lppc" },
        ],
      },
    };
    const diff = diffSnapshots(base, newer);
    expect(diff.clients.changed).toHaveLength(1);
    expect(diff.clients.changed[0].id).toBe("c1");
    expect(diff.clients.changed[0].fields.name).toEqual({
      from: "Convergix",
      to: "Convergix Industries",
    });
  });

  it("reports no changes when snapshots are identical", () => {
    const diff = diffSnapshots(base, base);
    for (const table of Object.values(diff)) {
      expect(table.added).toHaveLength(0);
      expect(table.removed).toHaveLength(0);
      expect(table.changed).toHaveLength(0);
    }
  });
});

describe("validateSnapshot", () => {
  it("passes for a complete snapshot", () => {
    const snapshot = buildSnapshot(
      {
        clients: [],
        projects: [],
        weekItems: [],
        pipelineItems: [],
        updates: [],
        teamMembers: [],
      },
      "file:test.db"
    );
    expect(() => validateSnapshot(snapshot)).not.toThrow();
  });

  it("throws for a snapshot missing a table", () => {
    const incomplete = {
      pulledAt: "2026-04-14T10:00:00Z",
      source: "file:test.db",
      tables: {
        clients: [],
        projects: [],
        // weekItems missing
        pipelineItems: [],
        updates: [],
        teamMembers: [],
      },
    } as unknown as ReturnType<typeof buildSnapshot>;
    expect(() => validateSnapshot(incomplete)).toThrow('missing table "weekItems"');
  });
});
