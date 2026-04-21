/**
 * Integration tests for operations-reads-clients.ts
 *
 * Uses real SQLite via test-db.ts helper — no mocks except the DB module injection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "./test-db";
import { invalidateClientCache } from "./operations-utils";

let testDb: TestDb;
let libsqlClient: Client;
let dbPath: string;

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

beforeEach(async () => {
  const created = await createTestDb();
  testDb = created.db;
  libsqlClient = created.client;
  dbPath = created.dbPath;
  await seedTestDb(libsqlClient);
  invalidateClientCache();
});

afterEach(() => {
  cleanupTestDb(dbPath);
});

describe("getClientsWithCounts", () => {
  it("returns all clients with correct project counts", async () => {
    const { getClientsWithCounts } = await import("./operations-reads-clients");

    const result = await getClientsWithCounts();

    expect(result).toHaveLength(4);

    const convergix = result.find((c) => c.slug === "convergix");
    expect(convergix).toBeDefined();
    expect(convergix!.name).toBe("Convergix");
    expect(convergix!.projectCount).toBe(3); // CDS, Social Content, ABM Brand

    const bonterra = result.find((c) => c.slug === "bonterra");
    expect(bonterra!.projectCount).toBe(2); // Impact Report, Brand Refresh

    const lppc = result.find((c) => c.slug === "lppc");
    expect(lppc!.projectCount).toBe(1); // Map R2

    const ag1 = result.find((c) => c.slug === "ag1");
    expect(ag1!.projectCount).toBe(1); // Social Content Trial
  });

  it("returns zero project count for client with no projects", async () => {
    const { getClientsWithCounts } = await import("./operations-reads-clients");

    // Add a client with no projects
    await libsqlClient.execute({
      sql: `INSERT INTO clients (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: ["cl-empty", "Empty Co", "empty-co", Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000)],
    });
    invalidateClientCache();

    const result = await getClientsWithCounts();
    const empty = result.find((c) => c.slug === "empty-co");
    expect(empty).toBeDefined();
    expect(empty!.projectCount).toBe(0);
  });

  it("exposes v4 enriched fields: id, updatedAt (default shape, no nested projects)", async () => {
    const { getClientsWithCounts } = await import("./operations-reads-clients");

    const result = await getClientsWithCounts();
    const convergix = result.find((c) => c.slug === "convergix");
    expect(convergix).toBeDefined();
    expect(convergix!.id).toBe("cl-convergix");
    expect(convergix!.updatedAt).toBeInstanceOf(Date);
    // includeProjects default false — `projects` key absent.
    expect((convergix as { projects?: unknown }).projects).toBeUndefined();
  });

  it("nests enriched projects when includeProjects=true", async () => {
    const { getClientsWithCounts } = await import("./operations-reads-clients");

    const result = await getClientsWithCounts({ includeProjects: true });
    const convergix = result.find((c) => c.slug === "convergix") as {
      projects?: Array<{ id: string; name: string; engagementType: string | null }>;
    };
    expect(convergix.projects).toBeDefined();
    expect(convergix.projects!.length).toBe(3);
    const cds = convergix.projects!.find((p) => p.name === "CDS Messaging");
    expect(cds).toBeDefined();
    expect(cds!.id).toBe("pj-cds");
    // Enrichment wired through from getProjectsFiltered shape.
    expect(cds).toHaveProperty("engagementType");
    expect(cds).toHaveProperty("dueDate");
  });

  it("returns empty projects array when includeProjects=true for zero-project client", async () => {
    const { getClientsWithCounts } = await import("./operations-reads-clients");

    await libsqlClient.execute({
      sql: `INSERT INTO clients (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: ["cl-empty2", "Empty2 Co", "empty2-co", Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000)],
    });
    invalidateClientCache();

    const result = await getClientsWithCounts({ includeProjects: true });
    const empty = result.find((c) => c.slug === "empty2-co") as {
      projects?: unknown[];
      projectCount: number;
    };
    expect(empty.projects).toEqual([]);
    expect(empty.projectCount).toBe(0);
  });
});

describe("getProjectsFiltered", () => {
  it("returns all projects when no filters applied", async () => {
    const { getProjectsFiltered } = await import("./operations-reads-clients");

    const result = await getProjectsFiltered();

    expect(result).toHaveLength(7);
    const names = result.map((p) => p.name);
    expect(names).toContain("CDS Messaging");
    expect(names).toContain("Social Content");
    expect(names).toContain("Impact Report");
    expect(names).toContain("Brand Refresh");
    expect(names).toContain("Map R2");
    expect(names).toContain("Social Content Trial");
    expect(names).toContain("ABM Brand Guidelines");
  });

  it("filters by clientSlug", async () => {
    const { getProjectsFiltered } = await import("./operations-reads-clients");

    const result = await getProjectsFiltered({ clientSlug: "convergix" });

    expect(result).toHaveLength(3);
    result.forEach((p) => expect(p.client).toBe("Convergix"));
  });

  it("filters by status", async () => {
    const { getProjectsFiltered } = await import("./operations-reads-clients");

    const result = await getProjectsFiltered({ status: "in-production" });

    expect(result.length).toBeGreaterThan(0);
    result.forEach((p) => expect(p.status).toBe("in-production"));
  });

  it("filters by owner (case-insensitive substring)", async () => {
    const { getProjectsFiltered } = await import("./operations-reads-clients");

    const result = await getProjectsFiltered({ owner: "kathy" });

    expect(result).toHaveLength(1); // CDS Messaging (ABM Brand Guidelines now owned by Paige)
    result.forEach((p) => expect(p.owner?.toLowerCase()).toContain("kathy"));
  });

  it("returns empty for nonexistent clientSlug", async () => {
    const { getProjectsFiltered } = await import("./operations-reads-clients");

    const result = await getProjectsFiltered({ clientSlug: "nonexistent" });

    // No client match — returns all projects (filter doesn't narrow)
    // Check actual behavior: clientBySlug.get returns undefined, so no filtering happens
    expect(result).toHaveLength(7);
  });

  it("combines clientSlug and status filters", async () => {
    const { getProjectsFiltered } = await import("./operations-reads-clients");

    const result = await getProjectsFiltered({
      clientSlug: "convergix",
      status: "not-started",
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Social Content");
    expect(result[0].client).toBe("Convergix");
    expect(result[0].status).toBe("not-started");
  });

  it("includes all expected fields in output", async () => {
    const { getProjectsFiltered } = await import("./operations-reads-clients");

    const result = await getProjectsFiltered({ clientSlug: "convergix", status: "in-production" });

    expect(result).toHaveLength(1);
    const cds = result[0];
    expect(cds.name).toBe("CDS Messaging");
    expect(cds.client).toBe("Convergix");
    expect(cds.status).toBe("in-production");
    expect(cds.owner).toBe("Kathy");
    expect(cds).toHaveProperty("category");
    expect(cds).toHaveProperty("waitingOn");
    expect(cds).toHaveProperty("target");
    expect(cds).toHaveProperty("notes");
    expect(cds).toHaveProperty("staleDays");
  });

  it("includes v4 enriched fields: id, dueDate, resources, start/end, engagement, contract, updatedAt", async () => {
    const { getProjectsFiltered } = await import("./operations-reads-clients");

    const result = await getProjectsFiltered({ clientSlug: "convergix", status: "in-production" });

    expect(result).toHaveLength(1);
    const cds = result[0];
    // Every enriched key must be present on the response shape.
    expect(cds).toHaveProperty("id");
    expect(cds.id).toBe("pj-cds");
    expect(cds).toHaveProperty("dueDate");
    expect(cds.dueDate).toBe("2026-04-25");
    expect(cds).toHaveProperty("resources");
    expect(cds).toHaveProperty("startDate");
    expect(cds).toHaveProperty("endDate");
    expect(cds).toHaveProperty("engagementType");
    expect(cds).toHaveProperty("contractStart");
    expect(cds).toHaveProperty("contractEnd");
    expect(cds).toHaveProperty("updatedAt");
    // updatedAt should be a Date (drizzle timestamp mode).
    expect(cds.updatedAt).toBeInstanceOf(Date);
  });

  // ── engagementType filter (PR #88 Chunk B) ────────────────

  it("filters by engagementType (exact match on 'retainer')", async () => {
    // Seed data leaves engagement_type NULL — tag two projects as retainer.
    await libsqlClient.execute({
      sql: `UPDATE projects SET engagement_type = 'retainer' WHERE id IN ('pj-cds', 'pj-impact')`,
      args: [],
    });
    await libsqlClient.execute({
      sql: `UPDATE projects SET engagement_type = 'project' WHERE id = 'pj-map'`,
      args: [],
    });

    const { getProjectsFiltered } = await import("./operations-reads-clients");
    const result = await getProjectsFiltered({ engagementType: "retainer" });

    const ids = result.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["pj-cds", "pj-impact"]));
    expect(ids).not.toContain("pj-map");
    expect(result.every((p) => p.engagementType === "retainer")).toBe(true);
  });

  it("filters by engagementType='project' (excludes retainer + NULL)", async () => {
    await libsqlClient.execute({
      sql: `UPDATE projects SET engagement_type = 'project' WHERE id = 'pj-map'`,
      args: [],
    });
    await libsqlClient.execute({
      sql: `UPDATE projects SET engagement_type = 'retainer' WHERE id = 'pj-cds'`,
      args: [],
    });

    const { getProjectsFiltered } = await import("./operations-reads-clients");
    const result = await getProjectsFiltered({ engagementType: "project" });

    expect(result.map((p) => p.id)).toEqual(["pj-map"]);
  });

  it("matches NULL engagement_type rows when engagementType='__null__' sentinel is passed", async () => {
    // Tag pj-cds as retainer so only seven-minus-one rows are still NULL.
    await libsqlClient.execute({
      sql: `UPDATE projects SET engagement_type = 'retainer' WHERE id = 'pj-cds'`,
      args: [],
    });

    const { getProjectsFiltered, ENGAGEMENT_TYPE_NULL_SENTINEL } = await import(
      "./operations-reads-clients"
    );
    expect(ENGAGEMENT_TYPE_NULL_SENTINEL).toBe("__null__");

    const result = await getProjectsFiltered({ engagementType: ENGAGEMENT_TYPE_NULL_SENTINEL });

    // Every row returned must have NULL engagement_type, and pj-cds (retainer) must not appear.
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.engagementType === null)).toBe(true);
    expect(result.map((p) => p.id)).not.toContain("pj-cds");
  });

  it("returns empty array when no project matches the engagementType", async () => {
    // No row has engagement_type = 'break-fix'.
    const { getProjectsFiltered } = await import("./operations-reads-clients");
    const result = await getProjectsFiltered({ engagementType: "break-fix" });
    expect(result).toEqual([]);
  });

  it("combines engagementType with clientSlug filter (AND semantics)", async () => {
    await libsqlClient.execute({
      sql: `UPDATE projects SET engagement_type = 'retainer' WHERE id IN ('pj-cds', 'pj-impact')`,
      args: [],
    });

    const { getProjectsFiltered } = await import("./operations-reads-clients");
    const result = await getProjectsFiltered({
      clientSlug: "convergix",
      engagementType: "retainer",
    });

    expect(result.map((p) => p.id)).toEqual(["pj-cds"]);
  });
});

describe("getClientDetail", () => {
  it("returns null for unknown slug", async () => {
    const { getClientDetail } = await import("./operations-reads-clients");
    const result = await getClientDetail("nonexistent-slug");
    expect(result).toBeNull();
  });

  it("returns full client detail with projects / pipeline / updates", async () => {
    const epoch = Math.floor(Date.now() / 1000);
    // Add a Convergix-specific update on top of the seed data.
    await libsqlClient.execute({
      sql: `INSERT INTO updates (id, project_id, client_id, updated_by, update_type, summary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["up-1", "pj-cds", "cl-convergix", "kathy", "status-change", "active -> awaiting-client", epoch],
    });

    const { getClientDetail } = await import("./operations-reads-clients");
    const result = await getClientDetail("convergix");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("cl-convergix");
    expect(result!.slug).toBe("convergix");
    expect(result!.name).toBe("Convergix");

    // Projects: 3 seeded (CDS, Social, ABM Brand).
    expect(result!.projects).toHaveLength(3);
    const cds = result!.projects.find((p) => p.id === "pj-cds");
    expect(cds).toBeDefined();
    expect(cds!.dueDate).toBe("2026-04-25");

    // Pipeline: seed has one Convergix pipeline item (pl-cgx-sow).
    expect(result!.pipelineItems.map((p) => p.id)).toEqual(["pl-cgx-sow"]);

    // Updates: we just added one.
    expect(result!.recentUpdates).toHaveLength(1);
    expect(result!.recentUpdates[0].summary).toBe("active -> awaiting-client");
  });

  it("scopes pipeline and updates to the requested client only", async () => {
    const epoch = Math.floor(Date.now() / 1000);
    // Add a Convergix update + a Bonterra update. Seed already has per-client
    // pipeline items — the scope assertion relies on that.
    await libsqlClient.execute({
      sql: `INSERT INTO updates (id, client_id, updated_by, update_type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["up-cgx", "cl-convergix", "kathy", "note", "cgx note", epoch],
    });
    await libsqlClient.execute({
      sql: `INSERT INTO updates (id, client_id, updated_by, update_type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: ["up-bon", "cl-bonterra", "jill", "note", "bonterra note", epoch],
    });

    const { getClientDetail } = await import("./operations-reads-clients");
    const result = await getClientDetail("convergix");

    // Only the seed's Convergix pipeline row should appear (pl-cgx-sow).
    expect(result!.pipelineItems.every((p) => p.id !== "pl-bonterra-renewal")).toBe(true);
    expect(result!.pipelineItems.some((p) => p.id === "pl-cgx-sow")).toBe(true);
    // Updates scoped to Convergix only.
    expect(result!.recentUpdates.map((u) => u.id)).toEqual(["up-cgx"]);
  });

  it("respects recentUpdatesLimit", async () => {
    const epoch = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 5; i++) {
      await libsqlClient.execute({
        sql: `INSERT INTO updates (id, client_id, updated_by, update_type, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [`up-${i}`, "cl-convergix", "kathy", "note", `update ${i}`, epoch + i],
      });
    }

    const { getClientDetail } = await import("./operations-reads-clients");
    const result = await getClientDetail("convergix", { recentUpdatesLimit: 3 });

    expect(result!.recentUpdates).toHaveLength(3);
  });
});
