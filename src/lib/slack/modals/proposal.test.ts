/**
 * Tests for `insertProposal` — shared bot_modal_proposals row inserter used by
 * both Wave 3 slash dispatcher (Builder 3) and Wave 7 bot LLM intercept
 * (Builder 7). DB-level cases require RUNWAY_DATABASE_URL.
 *
 * The helper test suite is split into:
 *   - pure-helper unit tests (default export shape, ID prefix, expiresAt math)
 *     — always run.
 *   - DB-level integration tests — skipped via `describe.skipIf` when
 *     RUNWAY_DATABASE_URL is not set, mirroring the pattern in
 *     `runway-schema.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { botModalProposals } from "@/lib/db/runway-schema";
import { insertProposal, updatePostedMessage } from "./proposal";

describe("insertProposal — pure helper invariants", () => {
  // The helper computes a fresh proposal id and expiresAt timestamp before
  // hitting the DB. We mock `getRunwayDb` to capture the row payload without
  // a live database. This protects the prefix + TTL contract that callers
  // (Builder 3 + Builder 7) rely on.
  it("computes id with prefix 'prop_' and expiresAt = now + 30 min by default", async () => {
    const inserts: unknown[] = [];
    vi.resetModules();
    vi.doMock("@/lib/db/runway", () => ({
      getRunwayDb: () => ({
        insert: () => ({
          values: (row: unknown) => {
            inserts.push(row);
            return Promise.resolve();
          },
        }),
      }),
    }));
    // Re-import after mocking so the mock binds.
    const mod = await import("./proposal");
    const before = Date.now();
    const out = await mod.insertProposal({
      kind: "create",
      toolName: "create_week_item",
      args: { title: "Foo" },
      userSlackId: "U_TEST_001",
      channelId: "C_TEST_001",
    });
    const after = Date.now();

    expect(out.proposalId).toMatch(/^prop_/);

    // Inspect the captured row.
    expect(inserts).toHaveLength(1);
    const row = inserts[0] as Record<string, unknown>;
    expect(row.id).toBe(out.proposalId);
    expect(row.kind).toBe("create");
    expect(row.toolName).toBe("create_week_item");
    expect(row.userSlackId).toBe("U_TEST_001");
    expect(row.channelId).toBe("C_TEST_001");
    expect(row.status).toBe("pending");
    expect(row.args).toBe(JSON.stringify({ title: "Foo" }));
    expect(row.targetEntityId).toBeNull();
    expect(row.targetEntityType).toBeNull();

    // expiresAt should be ~30 min after createdAt
    const createdAt = (row.createdAt as Date).getTime();
    const expiresAt = (row.expiresAt as Date).getTime();
    expect(createdAt).toBeGreaterThanOrEqual(before);
    expect(createdAt).toBeLessThanOrEqual(after);
    // Default TTL = 30 min = 1_800_000 ms
    expect(expiresAt - createdAt).toBe(30 * 60 * 1000);

    vi.doUnmock("@/lib/db/runway");
  });

  it("respects ttlMinutes override (e.g. 5 min for tests)", async () => {
    const inserts: unknown[] = [];
    vi.resetModules();
    vi.doMock("@/lib/db/runway", () => ({
      getRunwayDb: () => ({
        insert: () => ({
          values: (row: unknown) => {
            inserts.push(row);
            return Promise.resolve();
          },
        }),
      }),
    }));
    const mod = await import("./proposal");
    await mod.insertProposal({
      kind: "create",
      toolName: "create_team_member",
      args: {},
      userSlackId: "U2",
      channelId: "C2",
      ttlMinutes: 5,
    });
    const row = inserts[0] as Record<string, unknown>;
    const createdAt = (row.createdAt as Date).getTime();
    const expiresAt = (row.expiresAt as Date).getTime();
    expect(expiresAt - createdAt).toBe(5 * 60 * 1000);
    vi.doUnmock("@/lib/db/runway");
  });

  it("propagates kind='edit' fields (targetEntityId + targetEntityType)", async () => {
    const inserts: unknown[] = [];
    vi.resetModules();
    vi.doMock("@/lib/db/runway", () => ({
      getRunwayDb: () => ({
        insert: () => ({
          values: (row: unknown) => {
            inserts.push(row);
            return Promise.resolve();
          },
        }),
      }),
    }));
    const mod = await import("./proposal");
    await mod.insertProposal({
      kind: "edit",
      toolName: "update_project",
      args: { name: "AG1 Pro" },
      userSlackId: "U3",
      channelId: "C3",
      targetEntityId: "proj_123",
      targetEntityType: "project",
    });
    const row = inserts[0] as Record<string, unknown>;
    expect(row.kind).toBe("edit");
    expect(row.targetEntityId).toBe("proj_123");
    expect(row.targetEntityType).toBe("project");
    expect(row.toolName).toBe("update_project");
    vi.doUnmock("@/lib/db/runway");
  });

  it("propagates intentGroupId, parentProposalId, pendingProjectName, threadTs", async () => {
    const inserts: unknown[] = [];
    vi.resetModules();
    vi.doMock("@/lib/db/runway", () => ({
      getRunwayDb: () => ({
        insert: () => ({
          values: (row: unknown) => {
            inserts.push(row);
            return Promise.resolve();
          },
        }),
      }),
    }));
    const mod = await import("./proposal");
    await mod.insertProposal({
      kind: "create",
      toolName: "create_week_item",
      args: { title: "Brief draft" },
      userSlackId: "U4",
      channelId: "C4",
      threadTs: "1700000000.000099",
      intentGroupId: "ig_xyz",
      parentProposalId: "prop_parent",
      pendingProjectName: "AG1 Pro 2026",
    });
    const row = inserts[0] as Record<string, unknown>;
    expect(row.threadTs).toBe("1700000000.000099");
    expect(row.intentGroupId).toBe("ig_xyz");
    expect(row.parentProposalId).toBe("prop_parent");
    expect(row.pendingProjectName).toBe("AG1 Pro 2026");
    vi.doUnmock("@/lib/db/runway");
  });

  it("serializes args as JSON string", async () => {
    const inserts: unknown[] = [];
    vi.resetModules();
    vi.doMock("@/lib/db/runway", () => ({
      getRunwayDb: () => ({
        insert: () => ({
          values: (row: unknown) => {
            inserts.push(row);
            return Promise.resolve();
          },
        }),
      }),
    }));
    const mod = await import("./proposal");
    const args = { a: 1, b: "two", c: [3, 4], d: { nested: true } };
    await mod.insertProposal({
      kind: "create",
      toolName: "create_project",
      args,
      userSlackId: "U5",
      channelId: "C5",
    });
    const row = inserts[0] as Record<string, unknown>;
    expect(typeof row.args).toBe("string");
    expect(JSON.parse(row.args as string)).toEqual(args);
    vi.doUnmock("@/lib/db/runway");
  });
});

// ============================================================
// updatePostedMessage helper — Carryover #2 (Builder 10)
// ============================================================
describe("updatePostedMessage — set posted_message_ts + posted_message_channel", () => {
  it("issues an UPDATE with the right WHERE clause and patch", async () => {
    const setSpy = vi.fn();
    const whereSpy = vi.fn();
    vi.resetModules();
    vi.doMock("@/lib/db/runway", () => ({
      getRunwayDb: () => ({
        update: () => ({
          set: (patch: Record<string, unknown>) => {
            setSpy(patch);
            return {
              where: (cond: unknown) => {
                whereSpy(cond);
                return Promise.resolve();
              },
            };
          },
        }),
      }),
    }));
    const mod = await import("./proposal");
    await mod.updatePostedMessage("prop_abc123", "1700000000.000099", "C_TEST");
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith({
      postedMessageTs: "1700000000.000099",
      postedMessageChannel: "C_TEST",
    });
    expect(whereSpy).toHaveBeenCalledTimes(1);
    vi.doUnmock("@/lib/db/runway");
  });
});

// Touch the export to make sure the test still type-checks against the
// actual module surface.
void updatePostedMessage;

// ============================================================
// DB-level integration test — round-trips a proposal through the real
// schema. Skipped when RUNWAY_DATABASE_URL is not set.
// ============================================================
describe.skipIf(!process.env.RUNWAY_DATABASE_URL)(
  "insertProposal (DB-level)",
  () => {
    it("inserts a row that round-trips through botModalProposals", async () => {
      const { getRunwayDb } = await import("@/lib/db/runway");
      const db = getRunwayDb();
      const out = await insertProposal({
        kind: "create",
        toolName: "create_week_item",
        args: { title: "DB test task" },
        userSlackId: "U_DB_TEST",
        channelId: "C_DB_TEST",
      });
      try {
        const rows = await db
          .select()
          .from(botModalProposals)
          .where(eq(botModalProposals.id, out.proposalId))
          .limit(1);
        expect(rows).toHaveLength(1);
        expect(rows[0].kind).toBe("create");
        expect(rows[0].status).toBe("pending");
        expect(rows[0].toolName).toBe("create_week_item");
      } finally {
        await db
          .delete(botModalProposals)
          .where(eq(botModalProposals.id, out.proposalId));
      }
    });
  },
);
