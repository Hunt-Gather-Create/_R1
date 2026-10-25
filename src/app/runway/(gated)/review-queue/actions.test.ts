/**
 * The review queue actions against a real test database. Every table is
 * snapshotted before and after, so an action that writes anywhere but the
 * queue row fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";

const holder = vi.hoisted(() => ({ db: null as unknown, cookieValue: undefined as string | undefined }));

vi.mock("@/lib/db/runway", () => ({ getRunwayDb: () => holder.db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "runway_auth" && holder.cookieValue !== undefined ? { name, value: holder.cookieValue } : undefined,
  }),
}));

import { createTestDb, seedTestDb, cleanupTestDb } from "@/lib/runway/test-db";
import { signRunwayAuthCookie } from "@/lib/runway/auth-cookie";
import { approveReviewQueueRowAction, dismissReviewQueueRowAction } from "./actions";

const QUEUE_ROW = {
  id: "rq-1",
  run_id: "run-abc",
  payload_json: JSON.stringify({
    op: "updateWeekItemField",
    params: { weekOf: "2026-04-13", weekItemTitle: "CDS Copy Review", field: "status", newValue: "completed" },
    source: { sheetId: "s", rowNumber: 3, taskNo: "1.1" },
    applyOrder: 0,
    requiresReview: true,
    preflight: { statusValid: true, categoryValid: true },
    reason: "week item could not be resolved",
  }),
};

async function snapshotAllTables(client: Client): Promise<Record<string, unknown[]>> {
  const tables = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const out: Record<string, unknown[]> = {};
  for (const t of tables.rows) {
    const name = String(t.name);
    const rows = await client.execute(`SELECT * FROM "${name}" ORDER BY rowid`);
    out[name] = rows.rows.map((r) => ({ ...r }));
  }
  return out;
}

async function queueRow(client: Client) {
  const res = await client.execute("SELECT * FROM apply_review_queue WHERE id = 'rq-1'");
  return { ...res.rows[0] };
}

function form(id: string): FormData {
  const f = new FormData();
  f.set("id", id);
  return f;
}

describe("review queue actions", () => {
  let client: Client;
  let dbPath: string;

  beforeEach(async () => {
    vi.stubEnv("RUNWAY_AUTH_SECRET", "test-secret-do-not-use-in-prod");
    const t = await createTestDb();
    await seedTestDb(t.client);
    client = t.client;
    dbPath = t.dbPath;
    holder.db = t.db;
    holder.cookieValue = signRunwayAuthCookie();
    await client.execute({
      sql: "INSERT INTO apply_review_queue (id, run_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
      args: [QUEUE_ROW.id, QUEUE_ROW.run_id, QUEUE_ROW.payload_json, 1792800000],
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    client.close();
    cleanupTestDb(dbPath);
  });

  for (const [label, action, status] of [
    ["Approve", approveReviewQueueRowAction, "approved"],
    ["Dismiss", dismissReviewQueueRowAction, "dismissed"],
  ] as const) {
    it(`${label} sets status, resolved_at and resolved_by on the queue row and changes no other table`, async () => {
      const before = await snapshotAllTables(client);
      const startSec = Math.floor(Date.now() / 1000);

      const res = await action(null, form("rq-1"));

      expect(res).toEqual({ ok: true, message: expect.any(String) });
      const after = await snapshotAllTables(client);
      const row = await queueRow(client);
      expect(row.status).toBe(status);
      expect(row.resolved_by).toBe("operator");
      expect(Number(row.resolved_at)).toBeGreaterThanOrEqual(startSec);
      expect(row).toMatchObject({ run_id: "run-abc", payload_json: QUEUE_ROW.payload_json });

      const { apply_review_queue: queueBefore, ...otherBefore } = before;
      const { apply_review_queue: queueAfter, ...otherAfter } = after;
      expect(otherAfter).toEqual(otherBefore);
      expect(queueAfter).toHaveLength(queueBefore!.length);
    });

    it(`${label} refuses a row that is already resolved`, async () => {
      await client.execute(
        "UPDATE apply_review_queue SET status = 'dismissed', resolved_at = 1792800500, resolved_by = 'earlier' WHERE id = 'rq-1'",
      );
      const before = await snapshotAllTables(client);

      const res = await action(null, form("rq-1"));

      expect(res).toEqual({ ok: false, message: expect.stringMatching(/already resolved/i) });

      expect(await snapshotAllTables(client)).toEqual(before);
    });

    it(`${label} refuses a caller without the Runway gate cookie`, async () => {
      holder.cookieValue = undefined;
      const before = await snapshotAllTables(client);

      await expect(action(null, form("rq-1"))).rejects.toThrow(/not signed in/i);

      expect(await snapshotAllTables(client)).toEqual(before);
    });
  }

  it("refuses an id that is not in the queue", async () => {
    const res = await approveReviewQueueRowAction(null, form("missing"));
    expect(res).toEqual({ ok: false, message: expect.stringMatching(/not found/i) });
  });
});
