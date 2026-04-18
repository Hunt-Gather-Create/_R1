/**
 * Integration test for migration 001-april-14-updates
 *
 * Uses real SQLite via test-db.ts helper. Verifies the migration
 * modifies DB state correctly when run in apply mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  getProject,
  getClient,
  getTeamMember,
  type TestDb,
} from "@/lib/runway/test-db";
import { projects, weekItems } from "@/lib/db/runway-schema";
import type { MigrationContext } from "../runway-migrate";

// ── Mock setup ──────────────────────────────────────────

let testDb: TestDb;
let rawClient: Client;
let dbPath: string;

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

beforeEach(async () => {
  const result = await createTestDb();
  rawClient = result.client;
  testDb = result.db;
  dbPath = result.dbPath;
  await seedTestDb(rawClient);

  const { invalidateClientCache } = await import(
    "@/lib/runway/operations-utils"
  );
  invalidateClientCache();
});

afterEach(() => {
  cleanupTestDb(dbPath);
});

// ── Test ──────────────────────────────────────────────────

describe("001-april-14-updates migration", () => {
  it("applies all changes correctly", async () => {
    const { up } = await import("./001-april-14-updates");

    // Build migration context in apply mode (dryRun: false)
    const logs: string[] = [];
    const ctx: MigrationContext = {
      db: drizzle(rawClient),
      dryRun: false,
      log: (message: string) => logs.push(message),
      logs,
    };

    await up(ctx);

    // Verify Section 1: Team member changes
    const ronan = await getTeamMember(testDb, "tm-ronan");
    expect(ronan?.isActive).toBe(0);

    const jill = await getTeamMember(testDb, "tm-jill");
    const jillAccounts: string[] = JSON.parse(jill?.accountsLed ?? "[]");
    expect(jillAccounts).toContain("hopdoddy");
    expect(jillAccounts).toContain("soundly");
    expect(jillAccounts).toContain("bonterra"); // existing preserved

    const kathy = await getTeamMember(testDb, "tm-kathy");
    const kathyAccounts: string[] = JSON.parse(kathy?.accountsLed ?? "[]");
    expect(kathyAccounts).toContain("lppc");
    expect(kathyAccounts).toContain("convergix"); // existing preserved

    // Verify Section 5: Bonterra cleanup
    const brandRefresh = await getProject(testDb, "pj-brand-refresh");
    expect(brandRefresh).toBeNull(); // deleted

    const impactReport = await getProject(testDb, "pj-impact");
    expect(impactReport?.notes).toContain(
      "Client was 3 weeks late on content"
    );

    const bonterra = await getClient(testDb, "cl-bonterra");
    expect(bonterra?.contractStatus).toBe("signed");

    // Verify Section 3: Resource swaps (Roz → Lane, Paige → Lane)
    // pj-social-cgx had owner "Roz" — should now be "Lane"
    const socialContent = await getProject(testDb, "pj-social-cgx");
    expect(socialContent?.owner).toBe("Lane");

    // pj-brand had owner "Paige" — should now be "Lane"
    const abmBrand = await getProject(testDb, "pj-brand");
    expect(abmBrand?.owner).toBe("Lane");

    // wi-cds-review had resources "Roz" — should now be "Lane"
    const allItems = await testDb.select().from(weekItems);
    const cdsReview = allItems.find((i) => i.id === "wi-cds-review");
    expect(cdsReview?.resources).toBe("Lane");

    // Verify no "Roz" or "Paige" remain in any project owner/resources
    const allProjects = await testDb.select().from(projects);
    for (const project of allProjects) {
      if (project.owner) {
        expect(project.owner.toLowerCase()).not.toContain("roz");
        expect(project.owner.toLowerCase()).not.toContain("paige");
      }
      if (project.resources) {
        expect(project.resources.toLowerCase()).not.toContain("roz");
        expect(project.resources.toLowerCase()).not.toContain("paige");
      }
    }

    // Verify logs were produced
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes("Section 1"))).toBe(true);
    expect(logs.some((l) => l.includes("Section 5"))).toBe(true);
    expect(logs.some((l) => l.includes("Stale Items"))).toBe(true);
  });

  it("dry-run produces logs but makes no changes", async () => {
    const { up } = await import("./001-april-14-updates");

    // Snapshot before
    const ronanBefore = await getTeamMember(testDb, "tm-ronan");
    const brandRefreshBefore = await getProject(testDb, "pj-brand-refresh");

    const logs: string[] = [];
    const ctx: MigrationContext = {
      db: drizzle(rawClient),
      dryRun: true,
      log: (message: string) => logs.push(message),
      logs,
    };

    await up(ctx);

    // Logs were produced
    expect(logs.length).toBeGreaterThan(0);

    // But no changes were made
    const ronanAfter = await getTeamMember(testDb, "tm-ronan");
    expect(ronanAfter?.isActive).toBe(ronanBefore?.isActive);

    const brandRefreshAfter = await getProject(testDb, "pj-brand-refresh");
    expect(brandRefreshAfter).not.toBeNull();
    expect(brandRefreshAfter?.name).toBe(brandRefreshBefore?.name);
  });
});
