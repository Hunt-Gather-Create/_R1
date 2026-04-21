/**
 * Integration tests for getFlags — the MCP/bot aggregate flags surface.
 *
 * Uses the shared in-memory SQLite seed. Asserts that the adapter correctly
 * feeds DB rows into the shared flag detectors + plate-summary helpers.
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

describe("getFlags", () => {
  it("returns the full flags result shape (flags/retainerRenewalDue/contractExpired)", async () => {
    const { getFlags } = await import("./operations-reads-flags");
    const result = await getFlags({ now: new Date("2026-04-20T12:00:00Z") });

    expect(result).toHaveProperty("flags");
    expect(result).toHaveProperty("retainerRenewalDue");
    expect(result).toHaveProperty("contractExpired");
    expect(Array.isArray(result.flags)).toBe(true);
    expect(Array.isArray(result.retainerRenewalDue)).toBe(true);
    expect(Array.isArray(result.contractExpired)).toBe(true);
  });

  it("raises retainer renewal pill for L1 retainers within 30 days of contract_end", async () => {
    // Mark Convergix CDS Messaging as a retainer ending 2026-05-10 (20 days
    // out from our "now" of 2026-04-20).
    await libsqlClient.execute({
      sql: `UPDATE projects SET engagement_type = ?, contract_end = ? WHERE id = ?`,
      args: ["retainer", "2026-05-10", "pj-cds"],
    });

    const { getFlags } = await import("./operations-reads-flags");
    const result = await getFlags({ now: new Date("2026-04-20T12:00:00Z") });

    expect(result.retainerRenewalDue.map((p) => p.projectName)).toContain("CDS Messaging");
  });

  it("raises contract-expired pill for clients with expired contracts + active L1", async () => {
    await libsqlClient.execute({
      sql: `UPDATE clients SET contract_status = ? WHERE id = ?`,
      args: ["expired", "cl-convergix"],
    });

    const { getFlags } = await import("./operations-reads-flags");
    const result = await getFlags({ now: new Date("2026-04-20T12:00:00Z") });

    expect(result.contractExpired.map((p) => p.clientName)).toContain("Convergix");
  });

  it("narrows results by clientSlug", async () => {
    await libsqlClient.execute({
      sql: `UPDATE clients SET contract_status = ? WHERE id = ?`,
      args: ["expired", "cl-convergix"],
    });
    await libsqlClient.execute({
      sql: `UPDATE clients SET contract_status = ? WHERE id = ?`,
      args: ["expired", "cl-bonterra"],
    });

    const { getFlags } = await import("./operations-reads-flags");
    const result = await getFlags({
      clientSlug: "convergix",
      now: new Date("2026-04-20T12:00:00Z"),
    });

    expect(result.contractExpired.map((p) => p.clientName)).toEqual(["Convergix"]);
  });

  it("narrows flags by personName (substring on relatedPerson)", async () => {
    // Plant 3 waitingOn entries on Kathy's Convergix projects to trigger
    // the bottleneck detector (3+ items across 2+ clients). Spread across
    // Convergix + Bonterra so the multi-client guard passes.
    await libsqlClient.execute({
      sql: `UPDATE projects SET waiting_on = ? WHERE id = ?`,
      args: ["Kathy", "pj-cds"],
    });
    await libsqlClient.execute({
      sql: `UPDATE projects SET waiting_on = ? WHERE id = ?`,
      args: ["Kathy", "pj-social-cgx"],
    });
    await libsqlClient.execute({
      sql: `UPDATE projects SET waiting_on = ? WHERE id = ?`,
      args: ["Kathy", "pj-impact"],
    });

    const { getFlags } = await import("./operations-reads-flags");
    const result = await getFlags({
      personName: "kathy",
      now: new Date("2026-04-20T12:00:00Z"),
    });

    const bottlenecks = result.flags.filter((f) => f.type === "bottleneck");
    expect(bottlenecks.length).toBeGreaterThan(0);
    bottlenecks.forEach((f) => {
      expect(f.relatedPerson?.toLowerCase()).toContain("kathy");
    });
  });

  it("returns empty arrays when no flags exist and nothing matches filters", async () => {
    const { getFlags } = await import("./operations-reads-flags");
    const result = await getFlags({
      clientSlug: "nonexistent",
      now: new Date("2026-04-20T12:00:00Z"),
    });

    expect(result.flags).toEqual([]);
    expect(result.retainerRenewalDue).toEqual([]);
    expect(result.contractExpired).toEqual([]);
  });
});
