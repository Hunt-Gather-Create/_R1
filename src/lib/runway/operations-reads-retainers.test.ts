/**
 * Integration tests for operations-reads-retainers.ts — `getRetainerTeam`.
 *
 * Uses the shared test-db seed harness. Seeds synthetic retainer wrapper
 * rows on top of the default data so the cases assert real DB behavior.
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

/**
 * Insert a retainer wrapper plus `childCount` child L1s tied to the
 * Convergix client. Returns the wrapper id so the test can call
 * `getRetainerTeam(wrapperId)`.
 */
async function seedWrapper(
  opts: {
    wrapperId: string;
    wrapperName?: string;
    wrapperOwner?: string | null;
    children?: Array<{
      id: string;
      name: string;
      owner?: string | null;
      resources?: string | null;
    }>;
  },
): Promise<string> {
  const wrapperName = opts.wrapperName ?? "Convergix Retainer";
  const nowEpoch = Math.floor(Date.now() / 1000);
  await libsqlClient.execute({
    sql: `INSERT INTO projects
          (id, client_id, name, status, category, engagement_type, owner, sort_order, created_at, updated_at)
          VALUES (?, 'cl-convergix', ?, 'in-production', 'active', 'retainer', ?, 100, ?, ?)`,
    args: [
      opts.wrapperId,
      wrapperName,
      opts.wrapperOwner ?? null,
      nowEpoch,
      nowEpoch,
    ],
  });
  for (const child of opts.children ?? []) {
    await libsqlClient.execute({
      sql: `INSERT INTO projects
            (id, client_id, name, status, category, parent_project_id, owner, resources, sort_order, created_at, updated_at)
            VALUES (?, 'cl-convergix', ?, 'in-production', 'active', ?, ?, ?, 101, ?, ?)`,
      args: [
        child.id,
        child.name,
        opts.wrapperId,
        child.owner ?? null,
        child.resources ?? null,
        nowEpoch,
        nowEpoch,
      ],
    });
  }
  return opts.wrapperId;
}

describe("getRetainerTeam", () => {
  it("returns empty team + childProjectCount=0 for a wrapper with zero children", async () => {
    const wrapperId = await seedWrapper({
      wrapperId: "wrap-empty",
      wrapperName: "Empty Retainer",
      wrapperOwner: "Kathy",
    });
    const { getRetainerTeam } = await import("./operations-reads-retainers");
    const result = await getRetainerTeam(wrapperId);

    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.wrapperId).toBe("wrap-empty");
    expect(result.wrapperName).toBe("Empty Retainer");
    expect(result.clientName).toBe("Convergix");
    expect(result.childProjectCount).toBe(0);
    expect(result.team).toEqual([]);
    expect(result.owner).toBe("Kathy");
  });

  it("dedupes team members across children, accumulating roles and childProjectIds", async () => {
    const wrapperId = await seedWrapper({
      wrapperId: "wrap-dedup",
      children: [
        { id: "c1", name: "Brand Guide", owner: "Kathy", resources: "CD: Lane, CW: Kathy" },
        { id: "c2", name: "Fanuc Article", owner: "Kathy", resources: "CD: Lane" },
        { id: "c3", name: "Social Playbook", owner: "Leslie", resources: "Dev: Leslie" },
      ],
    });
    const { getRetainerTeam } = await import("./operations-reads-retainers");
    const result = await getRetainerTeam(wrapperId);

    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.childProjectCount).toBe(3);

    const kathy = result.team.find((m) => m.name === "Kathy");
    expect(kathy).toBeDefined();
    // Owner on c1, c2 + CW on c1 → 3 appearances
    expect(kathy!.roles).toHaveLength(3);
    expect(kathy!.childProjectIds.sort()).toEqual(["c1", "c2"]);

    const lane = result.team.find((m) => m.name === "Lane");
    expect(lane).toBeDefined();
    // CD on c1 and c2
    expect(lane!.roles).toHaveLength(2);
    expect(lane!.childProjectIds.sort()).toEqual(["c1", "c2"]);

    const leslie = result.team.find((m) => m.name === "Leslie");
    expect(leslie).toBeDefined();
    // Owner + Dev on c3 → 2 appearances
    expect(leslie!.roles).toHaveLength(2);
    expect(leslie!.childProjectIds).toEqual(["c3"]);

    // Sort: descending roles.length, then name ascending
    expect(result.team.map((m) => m.name)).toEqual(["Kathy", "Lane", "Leslie"]);
  });

  it("counts children with NULL owner and NULL resources toward childProjectCount but contributes no team entries", async () => {
    const wrapperId = await seedWrapper({
      wrapperId: "wrap-null",
      children: [
        { id: "c-null", name: "Unassigned Work", owner: null, resources: null },
        { id: "c-kathy", name: "Kathy's Work", owner: "Kathy" },
      ],
    });
    const { getRetainerTeam } = await import("./operations-reads-retainers");
    const result = await getRetainerTeam(wrapperId);

    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    expect(result.childProjectCount).toBe(2);
    expect(result.team.map((m) => m.name)).toEqual(["Kathy"]);
  });

  it("parses mixed role prefixes; bare entries get role='Resource'", async () => {
    const wrapperId = await seedWrapper({
      wrapperId: "wrap-roles",
      children: [
        {
          id: "c-mixed",
          name: "Project",
          resources: "CD: Lane, CW: Kathy, Leslie",
        },
      ],
    });
    const { getRetainerTeam } = await import("./operations-reads-retainers");
    const result = await getRetainerTeam(wrapperId);

    if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
    const leslie = result.team.find((m) => m.name === "Leslie");
    expect(leslie).toBeDefined();
    expect(leslie!.roles[0]).toContain("Resource (Project)");

    const lane = result.team.find((m) => m.name === "Lane");
    expect(lane!.roles[0]).toContain("CD (Project)");
  });

  it("returns { error } when the wrapper id doesn't exist", async () => {
    const { getRetainerTeam } = await import("./operations-reads-retainers");
    const result = await getRetainerTeam("does-not-exist");
    expect(result).toHaveProperty("error");
    if (!("error" in result)) throw new Error("expected error branch");
    expect(result.error).toContain("not found");
  });

  it("returns { error } when the project exists but isn't a retainer", async () => {
    // Seed default data includes non-retainer projects like pj-cds. Use one.
    const { getRetainerTeam } = await import("./operations-reads-retainers");
    const result = await getRetainerTeam("pj-cds");
    expect(result).toHaveProperty("error");
    if (!("error" in result)) throw new Error("expected error branch");
    expect(result.error).toBe("Not a retainer wrapper");
  });
});
