/**
 * Integration tests: `batch_apply` cannot bypass shared value validators.
 *
 * batch_apply dispatches directly to the underlying helper through
 * BATCH_DISPATCH, sidestepping the MCP wrapper's tool-boundary validation.
 * The helpers run the same shared validators as the wrapper
 * (validateEngagementType, validateIsoDateShape, validateWeekItemStatus,
 * validateWeekItemCategory) so any bypass attempt still rejects.
 *
 * Uses the real helpers backed by an in-memory SQLite DB (test-db.ts) —
 * no mocks for the operations barrel. This is the load-bearing coverage
 * for the P1-1 finding:
 *
 *   "Prove batch_apply can't bypass validation. The load-bearing test
 *    has to actually let the validator reject the bad value."
 *
 * If a contributor deletes a validator call from a helper, OR weakens a
 * validator in operations-utils to accept a bad value, these tests break.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Client as LibsqlClient } from "@libsql/client";
import {
  createTestDb,
  seedTestDb,
  cleanupTestDb,
  type TestDb,
} from "@/lib/runway/test-db";

let testDb: TestDb;
let libsqlClient: LibsqlClient;
let dbPath: string;

// The only mock: substitute the runway DB factory with the in-memory one.
// Everything else (operations barrel, validators, helpers, dispatch table)
// runs real code.
vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => testDb,
}));

// Slack updates channel is the one external side-effect a non-batched
// mutation would trigger. batch_apply suppresses it via setBatchId, but
// stub anyway so a regression that drops the suppression doesn't cause a
// real Slack post in CI.
vi.mock("@/lib/slack/updates-channel", () => ({
  postMutationUpdate: vi.fn().mockResolvedValue(undefined),
}));

// Captured batch_apply handler from registerRunwayTools. Populated in
// beforeEach so each test gets a fresh registration tied to the current
// testDb instance.
type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: [{ type: "text"; text: string }];
}>;
let batchApply: ToolHandler;

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool(
      name: string,
      _desc: string,
      _schema: unknown,
      handler: ToolHandler,
    ) {
      if (name === "batch_apply") batchApply = handler;
    }
  },
}));

beforeEach(async () => {
  const created = await createTestDb();
  testDb = created.db;
  libsqlClient = created.client;
  dbPath = created.dbPath;
  await seedTestDb(libsqlClient);

  // Register the tools AFTER testDb is assigned — registerRunwayTools
  // doesn't capture the DB itself, but the helpers it dispatches to
  // resolve `getRunwayDb()` lazily, so as long as the mock factory hands
  // back the current testDb, every dispatch hits the right DB.
  const { registerRunwayTools } = await import("./runway-tools");
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  registerRunwayTools(new McpServer({ name: "test", version: "1.0.0" }));
});

afterEach(() => {
  libsqlClient.close();
  cleanupTestDb(dbPath);
  vi.resetModules();
});

// ── Tests ─────────────────────────────────────────────────

describe("batch_apply cannot bypass shared validators (P1-1)", () => {
  it("update_project_field engagementType=retainer-v2 is rejected by the helper", async () => {
    const result = await batchApply({
      batchId: "bypass-test-engagement",
      updatedBy: "tester",
      ops: [
        {
          tool: "update_project_field",
          args: {
            clientSlug: "convergix",
            projectName: "CDS Messaging",
            field: "engagementType",
            newValue: "retainer-v2",
          },
        },
      ],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.data.results).toHaveLength(1);
    const r0 = parsed.data.results[0];
    expect(r0.ok).toBe(false);
    // Real validator's error format — see validateEngagementType in
    // operations-utils.ts. Asserting on the production format means a
    // future refactor that changes the error string must also update
    // this test (correct — test SHOULD detect a contract change).
    expect(r0.error).toBe(
      `engagementType must be one of retainer, project or '' (clear); got 'retainer-v2'.`,
    );

    // Confirm no row mutation actually happened.
    const projectRow = await libsqlClient.execute({
      sql: `SELECT engagement_type FROM projects WHERE id = 'pj-cds'`,
      args: [],
    });
    expect(projectRow.rows[0].engagement_type).toBeNull();
  });

  it("update_project_field contractStart=2026-13-45 is rejected by the helper", async () => {
    // The load-bearing case: lex compare against contractEnd would
    // silently accept "2026-13-45" without the validator. Helper-level
    // validateIsoDateShape catches it before the helper's invariant runs.
    const result = await batchApply({
      batchId: "bypass-test-iso",
      updatedBy: "tester",
      ops: [
        {
          tool: "update_project_field",
          args: {
            clientSlug: "convergix",
            projectName: "CDS Messaging",
            field: "contractStart",
            newValue: "2026-13-45",
          },
        },
      ],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    const r0 = parsed.data.results[0];
    expect(r0.ok).toBe(false);
    expect(r0.error).toBe(
      `contractStart must be a valid ISO YYYY-MM-DD date or '' (clear); got '2026-13-45'.`,
    );

    const projectRow = await libsqlClient.execute({
      sql: `SELECT contract_start FROM projects WHERE id = 'pj-cds'`,
      args: [],
    });
    expect(projectRow.rows[0].contract_start).toBeNull();
  });

  it("create_week_item status=bogus is rejected by the helper", async () => {
    const result = await batchApply({
      batchId: "bypass-test-status",
      updatedBy: "tester",
      ops: [
        {
          tool: "create_week_item",
          args: {
            clientSlug: "convergix",
            title: "Bad Status Item",
            weekOf: "2026-04-13",
            status: "bogus",
          },
        },
      ],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    const r0 = parsed.data.results[0];
    expect(r0.ok).toBe(false);
    expect(r0.error).toBe(
      `status must be one of scheduled, in-progress, blocked, at-risk, completed, canceled or '' (clear); got 'bogus'.`,
    );

    // Confirm no row was inserted.
    const inserted = await libsqlClient.execute({
      sql: `SELECT id FROM week_items WHERE title = 'Bad Status Item'`,
      args: [],
    });
    expect(inserted.rows).toHaveLength(0);
  });

  it("create_week_item category=bogus is rejected by the helper", async () => {
    const result = await batchApply({
      batchId: "bypass-test-category",
      updatedBy: "tester",
      ops: [
        {
          tool: "create_week_item",
          args: {
            clientSlug: "convergix",
            title: "Bad Category Item",
            weekOf: "2026-04-13",
            category: "bogus",
          },
        },
      ],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(false);
    const r0 = parsed.data.results[0];
    expect(r0.ok).toBe(false);
    expect(r0.error).toBe(
      `category must be one of delivery, review, kickoff, deadline, approval, launch or '' (clear); got 'bogus'.`,
    );

    const inserted = await libsqlClient.execute({
      sql: `SELECT id FROM week_items WHERE title = 'Bad Category Item'`,
      args: [],
    });
    expect(inserted.rows).toHaveLength(0);
  });
});
