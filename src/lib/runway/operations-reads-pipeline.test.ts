/**
 * Integration tests for operations-reads-pipeline.ts
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

describe("getPipelineData", () => {
  it("returns all pipeline items with client names resolved", async () => {
    const { getPipelineData } = await import("./operations-reads-pipeline");

    const result = await getPipelineData();

    expect(result).toHaveLength(3);

    const sow = result.find((i) => i.name === "SOW Expansion");
    expect(sow).toBeDefined();
    expect(sow!.account).toBe("Convergix");
    expect(sow!.status).toBe("proposal");
    expect(sow!.estimatedValue).toBe("50000");
    expect(sow!.waitingOn).toBe("Client review");
    expect(sow!.notes).toBe("Pending budget approval");

    const renewal = result.find((i) => i.name === "Annual Renewal");
    expect(renewal).toBeDefined();
    expect(renewal!.account).toBe("Bonterra");
    expect(renewal!.status).toBe("negotiation");
    expect(renewal!.estimatedValue).toBe("120000");

    const lead = result.find((i) => i.name === "Inbound Lead - Acme");
    expect(lead).toBeDefined();
    expect(lead!.account).toBeNull(); // No client linked
    expect(lead!.status).toBe("qualification");
  });

  it("returns empty when no pipeline items exist", async () => {
    const { getPipelineData } = await import("./operations-reads-pipeline");

    // Delete all pipeline items
    await libsqlClient.execute("DELETE FROM pipeline_items");

    const result = await getPipelineData();
    expect(result).toHaveLength(0);
  });
});

describe("getStaleItemsForAccounts", () => {
  it("returns stale projects for given client slugs", async () => {
    const { getStaleItemsForAccounts } = await import("./operations-reads-pipeline");

    // Seed projects have no staleDays set (null) and no updates,
    // so all active projects should be stale (no updates in 7 days)
    const result = await getStaleItemsForAccounts(["convergix"]);

    expect(result.length).toBeGreaterThan(0);
    result.forEach((item) => {
      expect(item.clientName).toBe("Convergix");
    });
    const projectNames = result.map((i) => i.projectName);
    expect(projectNames).toContain("CDS Messaging");
    expect(projectNames).toContain("Social Content");
    // ABM Brand Guidelines is awaiting-client, not completed/on-hold, so included
    expect(projectNames).toContain("ABM Brand Guidelines");
  });

  it("excludes completed and on-hold projects", async () => {
    const { getStaleItemsForAccounts } = await import("./operations-reads-pipeline");

    // Mark CDS Messaging as completed
    await libsqlClient.execute({
      sql: "UPDATE projects SET status = ? WHERE id = ?",
      args: ["completed", "pj-cds"],
    });

    const result = await getStaleItemsForAccounts(["convergix"]);
    const projectNames = result.map((i) => i.projectName);
    expect(projectNames).not.toContain("CDS Messaging");
  });

  it("returns empty for nonexistent client slug", async () => {
    const { getStaleItemsForAccounts } = await import("./operations-reads-pipeline");

    const result = await getStaleItemsForAccounts(["nonexistent"]);
    expect(result).toHaveLength(0);
  });

  it("returns empty for empty slugs array", async () => {
    const { getStaleItemsForAccounts } = await import("./operations-reads-pipeline");

    const result = await getStaleItemsForAccounts([]);
    expect(result).toHaveLength(0);
  });

  it("filters by personName when provided", async () => {
    const { getStaleItemsForAccounts } = await import("./operations-reads-pipeline");

    const result = await getStaleItemsForAccounts(["convergix"], "Kathy");

    // Kathy owns CDS Messaging (ABM Brand Guidelines is now owned by Paige)
    const projectNames = result.map((i) => i.projectName);
    expect(projectNames).toContain("CDS Messaging");
    // Paige owns ABM Brand Guidelines — should NOT appear for Kathy
    expect(projectNames).not.toContain("ABM Brand Guidelines");
    // Roz owns Social Content — should NOT appear
    expect(projectNames).not.toContain("Social Content");
  });

  it("marks project as not stale when it has a recent update", async () => {
    const { getStaleItemsForAccounts } = await import("./operations-reads-pipeline");

    // Insert a recent update for CDS Messaging
    const recentEpoch = Math.floor(Date.now() / 1000);
    await libsqlClient.execute({
      sql: `INSERT INTO updates (id, project_id, client_id, updated_by, update_type, summary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["upd-recent", "pj-cds", "cl-convergix", "Kathy", "status-change", "Updated status", recentEpoch],
    });

    const result = await getStaleItemsForAccounts(["convergix"]);
    const projectNames = result.map((i) => i.projectName);
    // CDS has a recent update now, should NOT be stale
    expect(projectNames).not.toContain("CDS Messaging");
    // Others still stale
    expect(projectNames).toContain("Social Content");
  });

  it("considers staleDays >= 7 as stale", async () => {
    const { getStaleItemsForAccounts } = await import("./operations-reads-pipeline");

    // Set staleDays on a project and also give it a recent update
    const recentEpoch = Math.floor(Date.now() / 1000);
    await libsqlClient.execute({
      sql: "UPDATE projects SET stale_days = ? WHERE id = ?",
      args: [10, "pj-cds"],
    });
    await libsqlClient.execute({
      sql: `INSERT INTO updates (id, project_id, client_id, updated_by, update_type, summary, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: ["upd-recent2", "pj-cds", "cl-convergix", "Kathy", "note", "test", recentEpoch],
    });

    const result = await getStaleItemsForAccounts(["convergix"]);
    const cds = result.find((i) => i.projectName === "CDS Messaging");
    // Still stale because staleDays=10 >= 7 even though it has a recent update
    expect(cds).toBeDefined();
    expect(cds!.staleDays).toBe(10);
  });

  it("sorts results by staleDays descending", async () => {
    const { getStaleItemsForAccounts } = await import("./operations-reads-pipeline");

    // Set different staleDays values
    await libsqlClient.execute({
      sql: "UPDATE projects SET stale_days = ? WHERE id = ?",
      args: [5, "pj-cds"],
    });
    await libsqlClient.execute({
      sql: "UPDATE projects SET stale_days = ? WHERE id = ?",
      args: [15, "pj-social-cgx"],
    });

    const result = await getStaleItemsForAccounts(["convergix"]);
    // Should be sorted by staleDays descending
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].staleDays).toBeGreaterThanOrEqual(result[i].staleDays);
    }
  });
});
