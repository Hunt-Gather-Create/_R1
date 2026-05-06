/**
 * Tests for `reEmitButtonsAfterParentSave` — Wave 8 / Builder 8.
 *
 * The helper runs after a parent project view_submission saves successfully.
 * It scans sibling proposals (same intentGroupId) whose pendingProjectName
 * matches the just-saved project's name, marks them resolved (sets
 * resolvedProjectId on each row), then re-emits the bot's button-bearing
 * message via `chat.update` so the previously-disabled task buttons swap
 * action_id from `task_button_disabled` -> `open_create_modal`.
 *
 * Per pre-plan v7 §B2: the button `value` always carries the proposalId from
 * initial render. `chat.update` only updates the action_id (style/emoji are
 * cosmetic). Tests pin this contract explicitly.
 *
 * Failure-mode coverage:
 *   - chat.update returns Slack error -> fall back to chat.postMessage with
 *     same blocks in same channel/thread.
 *   - Parent has no postedMessageTs -> bail gracefully (no throw).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { reEmitButtonsAfterParentSave } from "./multi-detect";

// ----------------------------------------------------------------------------
// Mock proposal shape — mirrors the live botModalProposals row, minus columns
// the helper does not read.
// ----------------------------------------------------------------------------
type MockProposal = {
  id: string;
  toolName: string;
  kind: "create" | "edit";
  intentGroupId: string | null;
  parentProposalId: string | null;
  pendingProjectName: string | null;
  postedMessageTs: string | null;
  postedMessageChannel: string | null;
  resolvedProjectId: string | null;
  status: "pending" | "submitted" | "cancelled" | "expired" | "failed";
  args: string;
};

function makeProposal(p: Partial<MockProposal> & { id: string }): MockProposal {
  return {
    toolName: "create_week_item",
    kind: "create",
    intentGroupId: "ig_test",
    parentProposalId: null,
    pendingProjectName: null,
    postedMessageTs: null,
    postedMessageChannel: null,
    resolvedProjectId: null,
    status: "pending",
    args: JSON.stringify({}),
    ...p,
  };
}

// ----------------------------------------------------------------------------
// Tiny db mock — supports the chained calls the helper makes:
//   - select().from(botModalProposals).where(eq(...)).limit(1)
//     (parent lookup by id)
//   - select().from(botModalProposals).where(eq(intentGroupId, ...))
//     (sibling list)
//   - update(botModalProposals).set({...}).where(eq(id, ...))
//     (resolve siblings)
// ----------------------------------------------------------------------------
function makeDbMock(rows: MockProposal[]) {
  const map = new Map(rows.map((r) => [r.id, r]));
  const updates: Array<{ id?: string; intentGroupId?: string; patch: Partial<MockProposal> }> = [];

  // Match by either id or intentGroupId — whichever the where clause filters by.
  const buildSelectChain = () => {
    let idMatch: string | undefined;
    let intentGroupMatch: string | undefined;
    const exec = (): MockProposal[] => {
      if (idMatch) {
        const r = map.get(idMatch);
        return r ? [r] : [];
      }
      if (intentGroupMatch) {
        return Array.from(map.values()).filter(
          (r) => r.intentGroupId === intentGroupMatch,
        );
      }
      return Array.from(map.values());
    };
    const chain: Record<string, unknown> = {
      from() {
        return chain;
      },
      where(filter: { _idMatch?: string; _intentGroupMatch?: string }) {
        if (filter?._idMatch) idMatch = filter._idMatch;
        if (filter?._intentGroupMatch) intentGroupMatch = filter._intentGroupMatch;
        return chain;
      },
      limit() {
        return Promise.resolve(exec());
      },
      then(resolve: (rows: MockProposal[]) => unknown) {
        return Promise.resolve(exec()).then(resolve);
      },
    };
    return chain;
  };

  const db = {
    select: () => buildSelectChain(),
    update: () => ({
      set: (patch: Partial<MockProposal>) => ({
        where: (filter: { _idMatch?: string; _intentGroupMatch?: string }) => {
          if (filter?._idMatch) {
            updates.push({ id: filter._idMatch, patch });
            const cur = map.get(filter._idMatch);
            if (cur) map.set(filter._idMatch, { ...cur, ...patch });
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db, map, updates };
}

// ----------------------------------------------------------------------------
// Slack client mock — captures chat.update + chat.postMessage calls.
// ----------------------------------------------------------------------------
function makeSlackMock(opts?: { chatUpdateError?: string }) {
  const chatUpdate = vi.fn(async () => {
    if (opts?.chatUpdateError) {
      const err = new Error(opts.chatUpdateError) as Error & {
        data?: { error?: string };
      };
      err.data = { error: opts.chatUpdateError };
      throw err;
    }
    return { ok: true };
  });
  const chatPostMessage = vi.fn().mockResolvedValue({ ok: true, ts: "1714493000.000100" });
  return {
    client: {
      chat: { update: chatUpdate, postMessage: chatPostMessage },
    } as unknown as Parameters<typeof reEmitButtonsAfterParentSave>[2],
    chatUpdate,
    chatPostMessage,
  };
}

// drizzle-orm `eq()` returns a sentinel the db mock can interpret. The helper
// only filters on id and intentGroupId, so we encode both.
beforeEach(() => {
  vi.resetModules();
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  return {
    ...actual,
    eq: (col: { name?: string } | unknown, value: unknown) => {
      // The runway-schema column names tell us which filter the helper used.
      const colName =
        typeof col === "object" && col !== null && "name" in (col as Record<string, unknown>)
          ? (col as { name?: string }).name
          : undefined;
      if (colName === "intent_group_id") {
        return { _intentGroupMatch: String(value) };
      }
      return { _idMatch: String(value) };
    },
  };
});

describe("reEmitButtonsAfterParentSave", () => {
  it("resolves a single sibling whose pendingProjectName matches", async () => {
    const parent = makeProposal({
      id: "prop_parent",
      toolName: "create_project",
      intentGroupId: "ig_one",
      postedMessageTs: "1714492800.001000",
      postedMessageChannel: "C_TEST_001",
    });
    const sibling = makeProposal({
      id: "prop_child_match",
      toolName: "create_week_item",
      intentGroupId: "ig_one",
      parentProposalId: "prop_parent",
      pendingProjectName: "AG1 Pro 2026",
    });
    const { db, updates } = makeDbMock([parent, sibling]);
    const { client, chatUpdate, chatPostMessage } = makeSlackMock();

    await reEmitButtonsAfterParentSave(
      "prop_parent",
      "proj_resolved_001",
      "AG1 Pro 2026",
      client,
      db as never,
    );

    // The matching sibling got resolvedProjectId set.
    expect(updates).toContainEqual(
      expect.objectContaining({
        id: "prop_child_match",
        patch: expect.objectContaining({ resolvedProjectId: "proj_resolved_001" }),
      }),
    );
    // chat.update fired exactly once on the parent's posted message.
    expect(chatUpdate).toHaveBeenCalledTimes(1);
    expect(chatPostMessage).not.toHaveBeenCalled();
    const call = chatUpdate.mock.calls[0][0] as {
      channel: string;
      ts: string;
      blocks: Array<Record<string, unknown>>;
    };
    expect(call.channel).toBe("C_TEST_001");
    expect(call.ts).toBe("1714492800.001000");
    expect(Array.isArray(call.blocks)).toBe(true);
  });

  it("with 3 siblings, only the matching one toggles to enabled", async () => {
    const parent = makeProposal({
      id: "prop_parent",
      toolName: "create_project",
      intentGroupId: "ig_three",
      postedMessageTs: "1714492800.001000",
      postedMessageChannel: "C_TEST_001",
    });
    const matching = makeProposal({
      id: "prop_child_match",
      intentGroupId: "ig_three",
      parentProposalId: "prop_parent",
      pendingProjectName: "AG1 Pro 2026",
    });
    // Two siblings whose pendingProjectName does NOT match the just-saved
    // project. They should stay disabled (no resolvedProjectId update) and
    // their action_id must remain task_button_disabled in the re-emitted blocks.
    const sibA = makeProposal({
      id: "prop_child_other_a",
      intentGroupId: "ig_three",
      parentProposalId: "prop_parent",
      pendingProjectName: "Different Project Name",
    });
    const sibB = makeProposal({
      id: "prop_child_other_b",
      intentGroupId: "ig_three",
      parentProposalId: "prop_parent",
      pendingProjectName: "Another Different",
    });
    const { db, updates } = makeDbMock([parent, matching, sibA, sibB]);
    const { client, chatUpdate } = makeSlackMock();

    await reEmitButtonsAfterParentSave(
      "prop_parent",
      "proj_resolved_001",
      "AG1 Pro 2026",
      client,
      db as never,
    );

    const updatedIds = updates.map((u) => u.id);
    expect(updatedIds).toContain("prop_child_match");
    expect(updatedIds).not.toContain("prop_child_other_a");
    expect(updatedIds).not.toContain("prop_child_other_b");

    expect(chatUpdate).toHaveBeenCalledTimes(1);
    const call = chatUpdate.mock.calls[0][0] as {
      blocks: Array<Record<string, unknown>>;
    };
    // Walk the actions block - the matching child gets open_create_modal and
    // siblings retain task_button_disabled. Both populate value=proposalId.
    const actionsBlock = call.blocks.find(
      (b) => (b as { type: string }).type === "actions",
    ) as { elements?: Array<Record<string, unknown>> } | undefined;
    expect(actionsBlock).toBeDefined();
    const els = actionsBlock?.elements ?? [];
    const findByValue = (v: string) =>
      els.find((e) => (e as { value?: string }).value === v) as
        | { action_id?: string; value?: string }
        | undefined;
    const matchedBtn = findByValue("prop_child_match");
    const otherABtn = findByValue("prop_child_other_a");
    const otherBBtn = findByValue("prop_child_other_b");
    expect(matchedBtn?.action_id).toBe("open_create_modal");
    expect(otherABtn?.action_id).toBe("task_button_disabled");
    expect(otherBBtn?.action_id).toBe("task_button_disabled");
  });

  it("when N siblings all match, all toggle to enabled", async () => {
    const parent = makeProposal({
      id: "prop_parent",
      toolName: "create_project",
      intentGroupId: "ig_all",
      postedMessageTs: "1714492800.001000",
      postedMessageChannel: "C_TEST_001",
    });
    const sibs = [1, 2, 3].map((n) =>
      makeProposal({
        id: `prop_child_${n}`,
        intentGroupId: "ig_all",
        parentProposalId: "prop_parent",
        pendingProjectName: "AG1 Pro 2026",
      }),
    );
    const { db, updates } = makeDbMock([parent, ...sibs]);
    const { client, chatUpdate } = makeSlackMock();

    await reEmitButtonsAfterParentSave(
      "prop_parent",
      "proj_resolved_001",
      "AG1 Pro 2026",
      client,
      db as never,
    );

    expect(updates.map((u) => u.id).sort()).toEqual([
      "prop_child_1",
      "prop_child_2",
      "prop_child_3",
    ]);
    expect(chatUpdate).toHaveBeenCalledTimes(1);
  });

  it("falls back to chat.postMessage when chat.update throws cant_update_message", async () => {
    const parent = makeProposal({
      id: "prop_parent",
      toolName: "create_project",
      intentGroupId: "ig_fallback",
      postedMessageTs: "1714492800.001000",
      postedMessageChannel: "C_TEST_001",
    });
    const sibling = makeProposal({
      id: "prop_child",
      intentGroupId: "ig_fallback",
      parentProposalId: "prop_parent",
      pendingProjectName: "AG1 Pro 2026",
    });
    const { db } = makeDbMock([parent, sibling]);
    const { client, chatUpdate, chatPostMessage } = makeSlackMock({
      chatUpdateError: "cant_update_message",
    });

    await reEmitButtonsAfterParentSave(
      "prop_parent",
      "proj_resolved_001",
      "AG1 Pro 2026",
      client,
      db as never,
    );

    expect(chatUpdate).toHaveBeenCalledTimes(1);
    expect(chatPostMessage).toHaveBeenCalledTimes(1);
    const fallback = chatPostMessage.mock.calls[0][0] as {
      channel: string;
      blocks: unknown[];
    };
    expect(fallback.channel).toBe("C_TEST_001");
    expect(Array.isArray(fallback.blocks)).toBe(true);
  });

  it.each(["message_not_found", "edit_window_closed"])(
    "falls back to chat.postMessage on Slack error %s",
    async (slackError) => {
      const parent = makeProposal({
        id: "prop_parent",
        toolName: "create_project",
        intentGroupId: "ig_other_err",
        postedMessageTs: "1714492800.001000",
        postedMessageChannel: "C_TEST_001",
      });
      const sibling = makeProposal({
        id: "prop_child",
        intentGroupId: "ig_other_err",
        parentProposalId: "prop_parent",
        pendingProjectName: "AG1 Pro 2026",
      });
      const { db } = makeDbMock([parent, sibling]);
      const { client, chatPostMessage } = makeSlackMock({
        chatUpdateError: slackError,
      });

      await reEmitButtonsAfterParentSave(
        "prop_parent",
        "proj_resolved_001",
        "AG1 Pro 2026",
        client,
        db as never,
      );

      expect(chatPostMessage).toHaveBeenCalledTimes(1);
    },
  );

  it("does not call chat.postMessage when chat.update succeeds", async () => {
    const parent = makeProposal({
      id: "prop_parent",
      toolName: "create_project",
      intentGroupId: "ig_ok",
      postedMessageTs: "1714492800.001000",
      postedMessageChannel: "C_TEST_001",
    });
    const sibling = makeProposal({
      id: "prop_child",
      intentGroupId: "ig_ok",
      parentProposalId: "prop_parent",
      pendingProjectName: "AG1 Pro 2026",
    });
    const { db } = makeDbMock([parent, sibling]);
    const { client, chatUpdate, chatPostMessage } = makeSlackMock();

    await reEmitButtonsAfterParentSave(
      "prop_parent",
      "proj_resolved_001",
      "AG1 Pro 2026",
      client,
      db as never,
    );

    expect(chatUpdate).toHaveBeenCalledTimes(1);
    expect(chatPostMessage).not.toHaveBeenCalled();
  });

  it("bails gracefully (no throw, no slack calls) when parent has no postedMessageTs", async () => {
    const parent = makeProposal({
      id: "prop_parent",
      toolName: "create_project",
      intentGroupId: "ig_no_msg",
      postedMessageTs: null,
      postedMessageChannel: null,
    });
    const sibling = makeProposal({
      id: "prop_child",
      intentGroupId: "ig_no_msg",
      parentProposalId: "prop_parent",
      pendingProjectName: "AG1 Pro 2026",
    });
    const { db, updates } = makeDbMock([parent, sibling]);
    const { client, chatUpdate, chatPostMessage } = makeSlackMock();

    await expect(
      reEmitButtonsAfterParentSave(
        "prop_parent",
        "proj_resolved_001",
        "AG1 Pro 2026",
        client,
        db as never,
      ),
    ).resolves.not.toThrow();

    // Sibling should still get resolvedProjectId set (DB consistency wins)
    // even when the slack re-emit can't fire.
    expect(updates.find((u) => u.id === "prop_child")).toBeDefined();
    expect(chatUpdate).not.toHaveBeenCalled();
    expect(chatPostMessage).not.toHaveBeenCalled();
  });

  it("bails when parent proposal lookup misses (no throw, no updates, no slack calls)", async () => {
    const { db, updates } = makeDbMock([]);
    const { client, chatUpdate, chatPostMessage } = makeSlackMock();

    await expect(
      reEmitButtonsAfterParentSave(
        "prop_does_not_exist",
        "proj_anything",
        "AG1 Pro 2026",
        client,
        db as never,
      ),
    ).resolves.not.toThrow();

    expect(updates).toHaveLength(0);
    expect(chatUpdate).not.toHaveBeenCalled();
    expect(chatPostMessage).not.toHaveBeenCalled();
  });
});
