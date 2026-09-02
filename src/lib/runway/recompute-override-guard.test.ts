/**
 * Issue #16 — same-batch override guard inside `recomputeProjectDatesWith`.
 *
 * Integration tests against a real libSQL in-memory DB. Exercises the
 * JSON1 `json_extract` query against the `updates.metadata` blob, and
 * verifies per-field protection logic: an override on `startDate` in
 * the active batch should prevent that field from being clobbered by a
 * subsequent child write that drives the recompute, while `endDate`
 * recomputes normally. Cross-batch overrides are intentionally NOT
 * protected — that exit pin is verified here too.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, cleanupTestDb, type TestDb } from "./test-db";
import { withBatchId } from "./runway-als";

let testDb: TestDb;
let libsqlClient: Client;
let dbPath: string;

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

const NOW_EPOCH = Math.floor(Date.now() / 1000);

// Minimal seed: one client, one non-retainer project (so the retainer-wrapper
// guard inside recomputeProjectDatesWith does not short-circuit), and a
// couple of child week items whose date range will differ from the override.
async function seedMinimal(client: Client) {
  await client.executeMultiple(`
    CREATE TABLE clients (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      nicknames TEXT, contract_value TEXT, contract_term TEXT, contract_status TEXT,
      team TEXT, client_contacts TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL, client_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT,
      category TEXT, owner TEXT, resources TEXT, waiting_on TEXT, due_date TEXT,
      start_date TEXT, end_date TEXT, contract_start TEXT, contract_end TEXT,
      engagement_type TEXT, parent_project_id TEXT, notes TEXT, stale_days INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE week_items (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT, client_id TEXT, day_of_week TEXT,
      week_of TEXT, date TEXT, start_date TEXT, end_date TEXT, blocked_by TEXT,
      title TEXT NOT NULL, status TEXT, category TEXT, owner TEXT, resources TEXT,
      notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0, parent_task_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE pipeline_items (
      id TEXT PRIMARY KEY NOT NULL, client_id TEXT, name TEXT NOT NULL, owner TEXT,
      status TEXT, estimated_value TEXT, waiting_on TEXT, notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE updates (
      id TEXT PRIMARY KEY NOT NULL, idempotency_key TEXT UNIQUE, project_id TEXT,
      client_id TEXT, updated_by TEXT, update_type TEXT, previous_value TEXT,
      new_value TEXT, summary TEXT, metadata TEXT, batch_id TEXT,
      triggered_by_update_id TEXT, slack_message_ts TEXT, source TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE team_members (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, first_name TEXT, full_name TEXT,
      nicknames TEXT, title TEXT, slack_user_id TEXT UNIQUE, role_category TEXT,
      accounts_led TEXT, channel_purpose TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT
    );
  `);

  await client.executeMultiple(`
    INSERT INTO clients (id, name, slug, created_at, updated_at) VALUES
      ('cl-guard', 'GuardCo', 'guardco', ${NOW_EPOCH}, ${NOW_EPOCH});

    INSERT INTO projects (
      id, client_id, name, status, engagement_type,
      start_date, end_date, sort_order, created_at, updated_at
    ) VALUES
      ('pj-guard', 'cl-guard', 'Guarded Project', 'in-production', 'project',
       '2025-01-01', '2025-12-31', 0, ${NOW_EPOCH}, ${NOW_EPOCH});

    INSERT INTO week_items (
      id, project_id, client_id, week_of, start_date, end_date,
      title, status, sort_order, created_at, updated_at
    ) VALUES
      ('wi-a', 'pj-guard', 'cl-guard', '2025-06-09', '2025-06-09', '2025-06-13',
       'WI A', 'in-progress', 0, ${NOW_EPOCH}, ${NOW_EPOCH}),
      ('wi-b', 'pj-guard', 'cl-guard', '2025-06-16', '2025-06-16', '2025-06-20',
       'WI B', 'in-progress', 1, ${NOW_EPOCH}, ${NOW_EPOCH});
  `);
}

// Insert a date-override audit row directly. Pinning by hand isolates the
// guard logic from `overrideProjectDate`'s own behavior — the field whose
// override pin we want to test is the one we name in metadata.field.
async function insertOverrideAudit(opts: {
  id: string;
  projectId: string;
  field: "startDate" | "endDate";
  batchId: string | null;
}) {
  await libsqlClient.execute({
    sql: `INSERT INTO updates (
            id, idempotency_key, project_id, client_id, updated_by, update_type,
            previous_value, new_value, summary, metadata, batch_id,
            triggered_by_update_id, slack_message_ts, source, created_at
          ) VALUES (?, ?, ?, NULL, ?, 'date-override', NULL, NULL, ?, ?, ?, NULL, NULL, NULL, ?)`,
    args: [
      opts.id,
      opts.id,
      opts.projectId,
      "tester",
      `pin ${opts.field}`,
      JSON.stringify({ field: opts.field }),
      opts.batchId ?? null,
      Math.floor(Date.now() / 1000),
    ],
  });
}

beforeEach(async () => {
  const created = await createTestDb();
  testDb = created.db;
  libsqlClient = created.client;
  dbPath = created.dbPath;
  // The shared seed wires schemas we don't need here; use our own minimal seed.
  await seedMinimal(libsqlClient);
});

afterEach(() => {
  cleanupTestDb(dbPath);
});

describe("recomputeProjectDatesWith — #16 in-batch override guard", () => {
  it("preserves an overridden startDate when a child write would clobber it (same batch)", async () => {
    const { recomputeProjectDatesWith } = await import("./operations-writes-week");

    // Pin a wider startDate than the children's MIN via override row in batch.
    await libsqlClient.execute({
      sql: `UPDATE projects SET start_date = ?, end_date = ? WHERE id = 'pj-guard'`,
      args: ["2025-01-15", "2025-06-20"],
    });
    await insertOverrideAudit({
      id: "audit-pin-start",
      projectId: "pj-guard",
      field: "startDate",
      batchId: "batch-same",
    });

    // Inside the same batch, recompute reads children (min=2025-06-09) but
    // the guard sees the batch-tagged startDate override and keeps it.
    const result = await withBatchId("batch-same", () =>
      recomputeProjectDatesWith(testDb, "pj-guard"),
    );

    expect(result.startDate).toBe("2025-01-15"); // preserved
    expect(result.endDate).toBe("2025-06-20"); // recomputed (matches children's MAX)

    const rows = await libsqlClient.execute({
      sql: "SELECT start_date, end_date FROM projects WHERE id = 'pj-guard'",
      args: [],
    });
    expect(rows.rows[0].start_date).toBe("2025-01-15");
    expect(rows.rows[0].end_date).toBe("2025-06-20");
  });

  it("recomputes endDate when only startDate is overridden in the active batch", async () => {
    const { recomputeProjectDatesWith } = await import("./operations-writes-week");

    await libsqlClient.execute({
      sql: `UPDATE projects SET start_date = ?, end_date = ? WHERE id = 'pj-guard'`,
      args: ["2025-01-15", "2025-12-31"],
    });
    await insertOverrideAudit({
      id: "audit-pin-start-only",
      projectId: "pj-guard",
      field: "startDate",
      batchId: "batch-partial",
    });

    const result = await withBatchId("batch-partial", () =>
      recomputeProjectDatesWith(testDb, "pj-guard"),
    );

    expect(result.startDate).toBe("2025-01-15"); // preserved by guard
    expect(result.endDate).toBe("2025-06-20"); // recomputed to children's MAX
  });

  it("preserves both fields and skips the UPDATE entirely when both are overridden in batch", async () => {
    const { recomputeProjectDatesWith } = await import("./operations-writes-week");

    await libsqlClient.execute({
      sql: `UPDATE projects SET start_date = ?, end_date = ? WHERE id = 'pj-guard'`,
      args: ["2025-01-15", "2025-12-15"],
    });
    await insertOverrideAudit({
      id: "audit-pin-both-start",
      projectId: "pj-guard",
      field: "startDate",
      batchId: "batch-both",
    });
    await insertOverrideAudit({
      id: "audit-pin-both-end",
      projectId: "pj-guard",
      field: "endDate",
      batchId: "batch-both",
    });

    const before = await libsqlClient.execute({
      sql: "SELECT updated_at FROM projects WHERE id = 'pj-guard'",
      args: [],
    });

    const result = await withBatchId("batch-both", () =>
      recomputeProjectDatesWith(testDb, "pj-guard"),
    );

    expect(result.startDate).toBe("2025-01-15");
    expect(result.endDate).toBe("2025-12-15");

    // The "both-overridden" path returns the current values without writing,
    // so updated_at must not change.
    const after = await libsqlClient.execute({
      sql: "SELECT updated_at FROM projects WHERE id = 'pj-guard'",
      args: [],
    });
    expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at);
  });

  it("clobbers an override from a DIFFERENT batch (cross-batch is intentionally unprotected)", async () => {
    const { recomputeProjectDatesWith } = await import("./operations-writes-week");

    // Override was from yesterday's batch — not the current scope.
    await libsqlClient.execute({
      sql: `UPDATE projects SET start_date = ?, end_date = ? WHERE id = 'pj-guard'`,
      args: ["2025-01-15", "2025-12-31"],
    });
    await insertOverrideAudit({
      id: "audit-yesterday",
      projectId: "pj-guard",
      field: "startDate",
      batchId: "batch-yesterday",
    });

    const result = await withBatchId("batch-today", () =>
      recomputeProjectDatesWith(testDb, "pj-guard"),
    );

    expect(result.startDate).toBe("2025-06-09"); // clobbered to children's MIN
    expect(result.endDate).toBe("2025-06-20");
  });

  it("is a no-op when called outside any withBatchId scope (existing recompute behavior)", async () => {
    const { recomputeProjectDatesWith } = await import("./operations-writes-week");

    await libsqlClient.execute({
      sql: `UPDATE projects SET start_date = ?, end_date = ? WHERE id = 'pj-guard'`,
      args: ["2025-01-15", "2025-12-31"],
    });
    // An override exists with no batchId — outside of any batch scope, the
    // guard should not protect anything; clobber as before.
    await insertOverrideAudit({
      id: "audit-no-batch",
      projectId: "pj-guard",
      field: "startDate",
      batchId: null,
    });

    const result = await recomputeProjectDatesWith(testDb, "pj-guard");

    expect(result.startDate).toBe("2025-06-09");
    expect(result.endDate).toBe("2025-06-20");
  });

  it("ignores overrides for OTHER projects in the same batch", async () => {
    const { recomputeProjectDatesWith } = await import("./operations-writes-week");

    await libsqlClient.execute({
      sql: `UPDATE projects SET start_date = ?, end_date = ? WHERE id = 'pj-guard'`,
      args: ["2025-01-15", "2025-12-31"],
    });
    // Override row scoped to a DIFFERENT project — must not protect pj-guard.
    await insertOverrideAudit({
      id: "audit-wrong-project",
      projectId: "pj-other",
      field: "startDate",
      batchId: "batch-mixed",
    });

    const result = await withBatchId("batch-mixed", () =>
      recomputeProjectDatesWith(testDb, "pj-guard"),
    );

    expect(result.startDate).toBe("2025-06-09"); // clobbered — guard saw no pj-guard override
    expect(result.endDate).toBe("2025-06-20");
  });
});
