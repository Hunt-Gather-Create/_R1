import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
  updates,
  teamMembers,
  botModalProposals,
} from "./runway-schema";

describe("runway-schema", () => {
  it("exports all 6 tables", () => {
    expect(clients).toBeDefined();
    expect(projects).toBeDefined();
    expect(weekItems).toBeDefined();
    expect(pipelineItems).toBeDefined();
    expect(updates).toBeDefined();
    expect(teamMembers).toBeDefined();
  });

  it("clients table has expected columns", () => {
    const cols = Object.keys(clients);
    expect(cols).toContain("id");
    expect(cols).toContain("name");
    expect(cols).toContain("slug");
    expect(cols).toContain("nicknames");
    expect(cols).toContain("contractValue");
    expect(cols).toContain("contractStatus");
    expect(cols).toContain("team");
    expect(cols).toContain("clientContacts");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });

  it("projects table references clients via clientId", () => {
    const cols = Object.keys(projects);
    expect(cols).toContain("clientId");
    expect(cols).toContain("name");
    expect(cols).toContain("status");
    expect(cols).toContain("category");
    expect(cols).toContain("owner");
    expect(cols).toContain("sortOrder");
  });

  it("weekItems table has scheduling columns", () => {
    const cols = Object.keys(weekItems);
    expect(cols).toContain("dayOfWeek");
    expect(cols).toContain("weekOf");
    expect(cols).toContain("date");
    expect(cols).toContain("title");
    expect(cols).toContain("category");
  });

  it("pipelineItems table has business columns", () => {
    const cols = Object.keys(pipelineItems);
    expect(cols).toContain("clientId");
    expect(cols).toContain("name");
    expect(cols).toContain("status");
    expect(cols).toContain("estimatedValue");
    expect(cols).toContain("waitingOn");
  });

  it("updates table has audit columns", () => {
    const cols = Object.keys(updates);
    expect(cols).toContain("idempotencyKey");
    expect(cols).toContain("projectId");
    expect(cols).toContain("clientId");
    expect(cols).toContain("updatedBy");
    expect(cols).toContain("updateType");
    expect(cols).toContain("previousValue");
    expect(cols).toContain("newValue");
    expect(cols).toContain("summary");
  });

  it("teamMembers table has identity columns", () => {
    const cols = Object.keys(teamMembers);
    expect(cols).toContain("name");
    expect(cols).toContain("fullName");
    expect(cols).toContain("nicknames");
    expect(cols).toContain("title");
    expect(cols).toContain("slackUserId");
    expect(cols).toContain("isActive");
  });

  it("projects table has v4 timing + engagement columns", () => {
    const cols = Object.keys(projects);
    expect(cols).toContain("startDate");
    expect(cols).toContain("endDate");
    expect(cols).toContain("contractStart");
    expect(cols).toContain("contractEnd");
    expect(cols).toContain("engagementType");
  });

  it("weekItems table has v4 start/end + blocked_by columns", () => {
    const cols = Object.keys(weekItems);
    expect(cols).toContain("startDate");
    expect(cols).toContain("endDate");
    expect(cols).toContain("blockedBy");
  });

  it("updates table has v4 triggered_by_update_id column", () => {
    const cols = Object.keys(updates);
    expect(cols).toContain("triggeredByUpdateId");
  });

  // Slack Modal Wave 1 (2026-04-30) — new column on existing audit table.
  it("updates table has Wave 1 source column", () => {
    const cols = Object.keys(updates);
    expect(cols).toContain("source");
  });

  // Slack Modal Wave 1 (2026-04-30) — new bot_modal_proposals table.
  it("exports botModalProposals table", () => {
    expect(botModalProposals).toBeDefined();
  });

  it("botModalProposals table has all v7 columns", () => {
    const cols = Object.keys(botModalProposals);
    expect(cols).toContain("id");
    expect(cols).toContain("userSlackId");
    expect(cols).toContain("channelId");
    expect(cols).toContain("threadTs");
    expect(cols).toContain("toolName");
    expect(cols).toContain("kind");
    expect(cols).toContain("targetEntityId");
    expect(cols).toContain("targetEntityType");
    expect(cols).toContain("args");
    expect(cols).toContain("conversationRef");
    expect(cols).toContain("parentProposalId");
    expect(cols).toContain("intentGroupId");
    expect(cols).toContain("pendingProjectName");
    expect(cols).toContain("postedMessageTs");
    expect(cols).toContain("postedMessageChannel");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("expiresAt");
    expect(cols).toContain("status");
    expect(cols).toContain("statusReason");
    expect(cols).toContain("resolvedProjectId");
  });
});

// ============================================================
// DB-level integration tests for bot_modal_proposals.
// ------------------------------------------------------------
// Skipped when RUNWAY_DATABASE_URL is not set. The Phase 0 wave-end gate
// must run these in an env with the URL set (post `pnpm runway:push`).
// ============================================================
describe.skipIf(!process.env.RUNWAY_DATABASE_URL)(
  "botModalProposals (DB-level)",
  () => {
    // Helper: build a minimal proposal row payload. Values are timestamps
    // (Drizzle `mode: "timestamp"` columns expect Date instances).
    const makeProposal = (overrides: Partial<typeof botModalProposals.$inferInsert>) => {
      const now = new Date();
      const expires = new Date(now.getTime() + 30 * 60 * 1000); // +30m
      return {
        id: `prop_${Math.random().toString(36).slice(2, 12)}`,
        userSlackId: "U_TEST_USER",
        channelId: "C_TEST_CHANNEL",
        threadTs: null,
        toolName: "create_week_item",
        kind: "create",
        targetEntityId: null,
        targetEntityType: null,
        args: JSON.stringify({ title: "Test task" }),
        conversationRef: null,
        parentProposalId: null,
        intentGroupId: null,
        pendingProjectName: null,
        postedMessageTs: null,
        postedMessageChannel: null,
        createdAt: now,
        expiresAt: expires,
        status: "pending",
        statusReason: null,
        resolvedProjectId: null,
        ...overrides,
      } satisfies typeof botModalProposals.$inferInsert;
    };

    it("inserts a kind='create' proposal with all fields populated and loads it back", async () => {
      const { getRunwayDb } = await import("./runway");
      const db = getRunwayDb();
      const row = makeProposal({
        toolName: "create_project",
        kind: "create",
        args: JSON.stringify({ name: "AG1 Pro 2026", isRetainer: true }),
        intentGroupId: "ig_create_create_full",
        pendingProjectName: "AG1 Pro 2026",
        postedMessageTs: "1700000000.000100",
        postedMessageChannel: "C_TEST_CHANNEL",
        threadTs: "1700000000.000099",
        conversationRef: "ctx_abc",
      });
      await db.insert(botModalProposals).values(row);
      try {
        const loaded = await db
          .select()
          .from(botModalProposals)
          .where(eq(botModalProposals.id, row.id))
          .limit(1);
        expect(loaded).toHaveLength(1);
        expect(loaded[0].kind).toBe("create");
        expect(loaded[0].toolName).toBe("create_project");
        expect(loaded[0].targetEntityId).toBeNull();
        expect(loaded[0].pendingProjectName).toBe("AG1 Pro 2026");
        expect(loaded[0].postedMessageTs).toBe("1700000000.000100");
      } finally {
        await db.delete(botModalProposals).where(eq(botModalProposals.id, row.id));
      }
    });

    it("inserts a kind='edit' proposal with target_entity_id + target_entity_type", async () => {
      const { getRunwayDb } = await import("./runway");
      const db = getRunwayDb();
      const row = makeProposal({
        toolName: "update_week_item",
        kind: "edit",
        targetEntityId: "wi_existing_123",
        targetEntityType: "week_item",
        args: JSON.stringify({ currentValues: { title: "Old Title" } }),
      });
      await db.insert(botModalProposals).values(row);
      try {
        const loaded = await db
          .select()
          .from(botModalProposals)
          .where(eq(botModalProposals.id, row.id))
          .limit(1);
        expect(loaded[0].kind).toBe("edit");
        expect(loaded[0].targetEntityId).toBe("wi_existing_123");
        expect(loaded[0].targetEntityType).toBe("week_item");
      } finally {
        await db.delete(botModalProposals).where(eq(botModalProposals.id, row.id));
      }
    });

    it("transitions status pending -> submitted", async () => {
      const { getRunwayDb } = await import("./runway");
      const db = getRunwayDb();
      const row = makeProposal({});
      await db.insert(botModalProposals).values(row);
      try {
        await db
          .update(botModalProposals)
          .set({ status: "submitted", resolvedProjectId: "p_resolved_xyz" })
          .where(eq(botModalProposals.id, row.id));
        const loaded = await db
          .select()
          .from(botModalProposals)
          .where(eq(botModalProposals.id, row.id))
          .limit(1);
        expect(loaded[0].status).toBe("submitted");
        expect(loaded[0].resolvedProjectId).toBe("p_resolved_xyz");
      } finally {
        await db.delete(botModalProposals).where(eq(botModalProposals.id, row.id));
      }
    });

    it("transitions status pending -> expired", async () => {
      const { getRunwayDb } = await import("./runway");
      const db = getRunwayDb();
      const row = makeProposal({});
      await db.insert(botModalProposals).values(row);
      try {
        await db
          .update(botModalProposals)
          .set({ status: "expired" })
          .where(eq(botModalProposals.id, row.id));
        const loaded = await db
          .select()
          .from(botModalProposals)
          .where(eq(botModalProposals.id, row.id))
          .limit(1);
        expect(loaded[0].status).toBe("expired");
      } finally {
        await db.delete(botModalProposals).where(eq(botModalProposals.id, row.id));
      }
    });

    it("inserts a multi-detect chain (parent project + 3 children) sharing intent_group_id", async () => {
      const { getRunwayDb } = await import("./runway");
      const db = getRunwayDb();
      const intentGroupId = `ig_${Math.random().toString(36).slice(2, 12)}`;
      const parent = makeProposal({
        toolName: "create_project",
        kind: "create",
        args: JSON.stringify({ name: "AG1 Pro 2026", isRetainer: true }),
        intentGroupId,
        pendingProjectName: "AG1 Pro 2026",
      });
      const child1 = makeProposal({
        toolName: "create_week_item",
        intentGroupId,
        parentProposalId: parent.id,
        pendingProjectName: "AG1 Pro 2026",
        args: JSON.stringify({ title: "Concept Writeup", date: "2026-05-04" }),
      });
      const child2 = makeProposal({
        toolName: "create_week_item",
        intentGroupId,
        parentProposalId: parent.id,
        pendingProjectName: "AG1 Pro 2026",
        args: JSON.stringify({ title: "Concept Writeup", date: "2026-05-11" }),
      });
      const child3 = makeProposal({
        toolName: "create_week_item",
        intentGroupId,
        parentProposalId: parent.id,
        pendingProjectName: "AG1 Pro 2026",
        args: JSON.stringify({ title: "Concept Writeup", date: "2026-05-18" }),
      });
      await db.insert(botModalProposals).values([parent, child1, child2, child3]);
      try {
        const siblings = await db
          .select()
          .from(botModalProposals)
          .where(eq(botModalProposals.intentGroupId, intentGroupId));
        expect(siblings).toHaveLength(4);
        const children = siblings.filter((r) => r.parentProposalId === parent.id);
        expect(children).toHaveLength(3);
        expect(children.every((c) => c.pendingProjectName === "AG1 Pro 2026")).toBe(true);
      } finally {
        await db
          .delete(botModalProposals)
          .where(eq(botModalProposals.intentGroupId, intentGroupId));
      }
    });

    it("resolves pending_project_name to resolved_project_id", async () => {
      const { getRunwayDb } = await import("./runway");
      const db = getRunwayDb();
      const row = makeProposal({
        toolName: "create_week_item",
        kind: "create",
        pendingProjectName: "Brand Refresh Retainer 2026",
      });
      await db.insert(botModalProposals).values(row);
      try {
        // Simulate Wave 9 lazy reference resolution at view_submission time.
        await db
          .update(botModalProposals)
          .set({ resolvedProjectId: "p_resolved_brand_refresh" })
          .where(eq(botModalProposals.id, row.id));
        const loaded = await db
          .select()
          .from(botModalProposals)
          .where(eq(botModalProposals.id, row.id))
          .limit(1);
        expect(loaded[0].pendingProjectName).toBe("Brand Refresh Retainer 2026");
        expect(loaded[0].resolvedProjectId).toBe("p_resolved_brand_refresh");
      } finally {
        await db.delete(botModalProposals).where(eq(botModalProposals.id, row.id));
      }
    });
  }
);
