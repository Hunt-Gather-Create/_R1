import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, seedTestDb, cleanupTestDb } from "@/lib/runway/test-db";
import type { Client } from "@libsql/client";

import { findOrphanedParentProjects } from "./check-orphan-parent-project-ids";

describe("findOrphanedParentProjects", () => {
  let client: Client;
  let dbPath: string;

  beforeEach(async () => {
    const handle = await createTestDb();
    client = handle.client;
    dbPath = handle.dbPath;
    await seedTestDb(client);
  });

  afterEach(() => {
    client.close();
    cleanupTestDb(dbPath);
  });

  it("returns empty list when every parent_project_id resolves", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Add a wrapper plus a child pointing at it. Other seed projects have
    // parent_project_id IS NULL, which the validator ignores.
    await client.execute(`
      INSERT INTO projects (id, client_id, name, status, category, sort_order, created_at, updated_at)
      VALUES ('pj-wrapper', 'cl-convergix', '1H Convergix Retainer', 'in-production', 'active', 100, ${now}, ${now})
    `);
    await client.execute(`
      UPDATE projects SET parent_project_id = 'pj-wrapper' WHERE id = 'pj-cds'
    `);

    const orphans = await findOrphanedParentProjects(client);

    expect(orphans).toEqual([]);
  });

  it("flags a project whose parent_project_id points at a missing row", async () => {
    await client.execute(`
      UPDATE projects SET parent_project_id = 'pj-does-not-exist' WHERE id = 'pj-cds'
    `);

    const orphans = await findOrphanedParentProjects(client);

    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toEqual({
      projectId: "pj-cds",
      projectName: "CDS Messaging",
      parentProjectId: "pj-does-not-exist",
    });
  });

  it("returns multiple orphans when several rows reference missing parents", async () => {
    await client.execute(`
      UPDATE projects SET parent_project_id = 'missing-1' WHERE id = 'pj-cds'
    `);
    await client.execute(`
      UPDATE projects SET parent_project_id = 'missing-2' WHERE id = 'pj-impact'
    `);

    const orphans = await findOrphanedParentProjects(client);
    const ids = orphans.map((o) => o.projectId).sort();

    expect(ids).toEqual(["pj-cds", "pj-impact"]);
  });
});
