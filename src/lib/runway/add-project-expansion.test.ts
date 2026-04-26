/**
 * Integration tests for addProject v4 expansion: engagementType, contract
 * dates, startDate/endDate, parentProjectId. Verifies the cross-field
 * invariant (helper-level) and tx-wrapped parentProjectId validation
 * (rolls back the insert on validator failure).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Client } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "./test-db";

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
});

afterEach(() => {
  libsqlClient.close();
  cleanupTestDb(dbPath);
});

async function setEngagementType(id: string, value: string | null): Promise<void> {
  await libsqlClient.execute({
    sql: `UPDATE projects SET engagement_type = ? WHERE id = ?`,
    args: [value, id],
  });
}

async function projectByName(clientId: string, name: string) {
  const result = await libsqlClient.execute({
    sql: `SELECT * FROM projects WHERE client_id = ? AND name = ?`,
    args: [clientId, name],
  });
  return result.rows[0] ?? null;
}

describe("addProject — v4 metadata", () => {
  it("creates a project with engagementType + contract dates and writes audit", async () => {
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix",
      name: "2H Convergix Retainer",
      engagementType: "retainer",
      contractStart: "2026-08-01",
      contractEnd: "2027-01-31",
      owner: "Kathy",
      updatedBy: "test",
    });

    expect(result.ok).toBe(true);
    const row = await projectByName("cl-convergix", "2H Convergix Retainer");
    expect(row).not.toBeNull();
    expect(row?.engagement_type).toBe("retainer");
    expect(row?.contract_start).toBe("2026-08-01");
    expect(row?.contract_end).toBe("2027-01-31");

    const audit = await libsqlClient.execute(`
      SELECT update_type, new_value FROM updates
      WHERE update_type = 'new-item' AND new_value = '2H Convergix Retainer'
    `);
    expect(audit.rows.length).toBe(1);
  });

  it("rejects when contractStart >= contractEnd (cross-field invariant)", async () => {
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix",
      name: "Invalid Window",
      engagementType: "retainer",
      contractStart: "2026-07-01",
      contractEnd: "2026-06-01",
      updatedBy: "test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/contractStart .* must be < contractEnd/);

    // No row inserted.
    const row = await projectByName("cl-convergix", "Invalid Window");
    expect(row).toBeNull();
  });

  it("rejects parentProjectId targeting a non-retainer parent and rolls back the insert", async () => {
    // pj-cds defaults to engagement_type = NULL → not a retainer.
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix",
      name: "Should Not Persist",
      parentProjectId: "pj-cds",
      updatedBy: "test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/must be 'retainer'/);

    const row = await projectByName("cl-convergix", "Should Not Persist");
    expect(row).toBeNull();
  });

  it("rejects parentProjectId targeting a different client and rolls back the insert", async () => {
    // Make Bonterra's pj-impact a retainer; try to parent a Convergix project under it.
    await setEngagementType("pj-impact", "retainer");
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix",
      name: "Cross-Client Should Not Persist",
      parentProjectId: "pj-impact",
      updatedBy: "test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cross-client parenting forbidden/);

    const row = await projectByName("cl-convergix", "Cross-Client Should Not Persist");
    expect(row).toBeNull();
  });

  it("creates a child under a valid retainer wrapper", async () => {
    await setEngagementType("pj-cds", "retainer");
    const { addProject } = await import("./operations-add");
    const result = await addProject({
      clientSlug: "convergix",
      name: "Wrapper Child",
      parentProjectId: "pj-cds",
      owner: "Kathy",
      updatedBy: "test",
    });

    expect(result.ok).toBe(true);
    const row = await projectByName("cl-convergix", "Wrapper Child");
    expect(row?.parent_project_id).toBe("pj-cds");
  });
});
