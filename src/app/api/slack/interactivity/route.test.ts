/**
 * Tests for POST /api/slack/interactivity.
 *
 * Phase 1 scaffold coverage (request validation + routing shape):
 *   - Misconfigured signing secret (env missing)
 *   - HMAC signature verification: valid, invalid, missing, stale, tampered
 *   - URL-encoded body parsing: missing payload field, malformed JSON
 *   - Routing by `payload.type`:
 *       block_actions   -> known/unknown action_id branches
 *       view_submission -> known/unknown callback_id branches
 *       view_closed     -> NotImplementedError (Wave 11 wires)
 *       shortcut        -> 200 OK
 *       unknown         -> 400
 *
 * Wave 8 (Builder 8) coverage extends Phase 1 with the wired dispatchers:
 *   - block_actions/open_create_modal happy path (task + project + retainer +
 *     team-member; multi-match hint matrix; expired/submitted ephemeral)
 *   - block_actions/is_retainer_checkbox -> response_action: update
 *   - block_actions/task_button_disabled -> ephemeral when not yet resolved
 *   - block_actions/target_entity_picker -> views.update with currentValues
 *   - view_submission -> inngest.send dispatched with locked schema, HTTP 200
 *
 * Wave 11 still owns view_closed; the original Phase 1 NotImplementedError
 * test for that branch is kept verbatim.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadFixture,
  makeSlackSignature,
  mutateFixture,
  nowTimestamp,
} from "@/lib/slack/test-helpers";

const SIGNING_SECRET = "test_secret";

function encodePayload(payload: unknown): string {
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

// ----------------------------------------------------------------------------
// Shared route mocks — Builder 8 wires real handlers, so request-validation
// scaffolds and dispatcher tests both need a baseline mock set.
//
// Strategy mirrors src/app/api/slack/commands/route.test.ts:
//   - vi.resetModules() between setups so route imports the fresh mocks.
//   - Mock @/lib/db/runway, @/lib/slack/client, modal builders, fuzzy-match,
//     getProjectsFiltered, inngest, and multi-detect helper as needed.
//   - Tests that don't exercise the wired branches still get safe stubs so
//     the route module loads without ReferenceError.
// ----------------------------------------------------------------------------
type MockProposal = {
  id: string;
  toolName: string;
  kind: "create" | "edit";
  args: string;
  targetEntityId: string | null;
  targetEntityType: "project" | "week_item" | "team_member" | null;
  pendingProjectName: string | null;
  parentProposalId: string | null;
  intentGroupId: string | null;
  postedMessageTs: string | null;
  postedMessageChannel: string | null;
  resolvedProjectId: string | null;
  status: "pending" | "submitted" | "cancelled" | "expired" | "failed";
  expiresAt: Date;
  channelId: string;
  threadTs: string | null;
  userSlackId: string;
};

function makeProposal(overrides: Partial<MockProposal> = {}): MockProposal {
  return {
    id: "prop_01JKVQX5MNRZF8GH2TKXYZAB7C",
    toolName: "create_week_item",
    kind: "create",
    args: JSON.stringify({}),
    targetEntityId: null,
    targetEntityType: null,
    pendingProjectName: null,
    parentProposalId: null,
    intentGroupId: null,
    postedMessageTs: null,
    postedMessageChannel: null,
    resolvedProjectId: null,
    status: "pending",
    // 1 hour in the future by default; tests that need expired override.
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    channelId: "C_TEST_001",
    threadTs: null,
    userSlackId: "U_TEST_001",
    ...overrides,
  };
}

interface RouteMockHandles {
  proposals: Map<string, MockProposal>;
  proposalUpdates: Array<{ id: string; patch: Partial<MockProposal> }>;
  viewsOpen: ReturnType<typeof vi.fn>;
  viewsUpdate: ReturnType<typeof vi.fn>;
  postEphemeral: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  inngestSend: ReturnType<typeof vi.fn>;
  buildTaskModal: ReturnType<typeof vi.fn>;
  buildProjectModal: ReturnType<typeof vi.fn>;
  buildTeamMemberModal: ReturnType<typeof vi.fn>;
  buildEphemeralRetainerToggle: ReturnType<typeof vi.fn>;
  reEmitButtons: ReturnType<typeof vi.fn>;
  getProjectsFiltered: ReturnType<typeof vi.fn>;
  checkConcurrentProposal: ReturnType<typeof vi.fn>;
  recordProposalLifecycleTransition: ReturnType<typeof vi.fn>;
}

function setupRouteMocks(opts?: {
  proposals?: MockProposal[];
  projects?: Array<{ id: string; name: string }>;
  concurrentResult?:
    | { hasConcurrent: false }
    | { hasConcurrent: true; otherUser: string; otherTitle: string; createdAt: Date };
}): RouteMockHandles {
  const proposals = new Map<string, MockProposal>();
  for (const p of opts?.proposals ?? []) proposals.set(p.id, p);
  const proposalUpdates: Array<{ id: string; patch: Partial<MockProposal> }> = [];

  const viewsOpen = vi.fn().mockResolvedValue({ ok: true });
  const viewsUpdate = vi.fn().mockResolvedValue({ ok: true });
  const postEphemeral = vi.fn().mockResolvedValue({ ok: true });
  const postMessage = vi.fn().mockResolvedValue({ ok: true, ts: "1234.5678" });
  const inngestSend = vi.fn().mockResolvedValue({ ids: ["ev_test"] });
  const checkConcurrentProposal = vi
    .fn()
    .mockResolvedValue(opts?.concurrentResult ?? { hasConcurrent: false });
  const recordProposalLifecycleTransition = vi.fn();

  const buildTaskModal = vi.fn((p: Record<string, unknown>) => ({
    type: "modal",
    callback_id: "runway_new_task",
    __debug: { kind: "task", ...p },
  }));
  const buildProjectModal = vi.fn((p: Record<string, unknown>) => ({
    type: "modal",
    callback_id: "runway_new_project",
    __debug: { kind: "project", ...p },
  }));
  const buildTeamMemberModal = vi.fn((p: Record<string, unknown>) => ({
    type: "modal",
    callback_id: "runway_new_team_member",
    __debug: { kind: "team-member", ...p },
  }));
  const buildEphemeralRetainerToggle = vi.fn(() => ({
    response_action: "update",
    view: { type: "modal", callback_id: "runway_new_project", __debug: { toggled: true } },
  }));
  const reEmitButtons = vi.fn().mockResolvedValue(undefined);
  const getProjectsFiltered = vi.fn().mockResolvedValue(opts?.projects ?? []);

  // Drizzle-orm: stub `eq(col, val)` -> sentinel { _idMatch: val } so the db
  // mock can dispatch by id without parsing column refs.
  vi.resetModules();
  vi.doMock("drizzle-orm", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
    return {
      ...actual,
      eq: (_col: unknown, value: unknown) => ({ _idMatch: value }),
    };
  });

  // Tiny chainable db mock — only `botModalProposals` reads/writes are
  // exercised here; other tables short-circuit to empty arrays.
  vi.doMock("@/lib/db/runway", () => {
    const tableNameOf = (t: unknown): string => {
      const sym = Object.getOwnPropertySymbols(t as object).find(
        (s) => s.toString() === "Symbol(drizzle:Name)",
      );
      return sym ? ((t as Record<symbol, unknown>)[sym] as string) : "";
    };
    const buildSelect = () => {
      let activeTable = "";
      let idMatch: string | null = null;
      const exec = (): unknown[] => {
        if (activeTable === "bot_modal_proposals") {
          if (idMatch === null) return Array.from(proposals.values());
          const found = proposals.get(idMatch);
          return found ? [found] : [];
        }
        return [];
      };
      const chain: Record<string, unknown> = {
        from(t: unknown) {
          activeTable = tableNameOf(t);
          return chain;
        },
        where(filter: { _idMatch?: string }) {
          if (filter && typeof filter._idMatch === "string") idMatch = filter._idMatch;
          return chain;
        },
        limit() {
          return Promise.resolve(exec());
        },
        then(resolve: (rows: unknown[]) => unknown) {
          return Promise.resolve(exec()).then(resolve);
        },
      };
      return chain;
    };
    return {
      getRunwayDb: () => ({
        select: () => buildSelect(),
        update: (t: unknown) => ({
          set: (patch: Partial<MockProposal>) => ({
            where: (filter: { _idMatch?: string }) => {
              if (
                tableNameOf(t) === "bot_modal_proposals" &&
                typeof filter._idMatch === "string"
              ) {
                proposalUpdates.push({ id: filter._idMatch, patch });
                const cur = proposals.get(filter._idMatch);
                if (cur) proposals.set(filter._idMatch, { ...cur, ...patch });
              }
              return Promise.resolve();
            },
          }),
        }),
      }),
    };
  });

  vi.doMock("@/lib/slack/client", () => ({
    getSlackClient: () => ({
      views: { open: viewsOpen, update: viewsUpdate },
      chat: { postEphemeral, postMessage },
    }),
  }));

  vi.doMock("@/lib/slack/modals/concurrency-check", () => ({
    checkConcurrentProposal,
  }));

  vi.doMock("@/lib/slack/modals/observability", () => ({
    recordProposalLifecycleTransition,
  }));

  vi.doMock("@/lib/slack/modals/task", () => ({ buildTaskModal }));
  vi.doMock("@/lib/slack/modals/project", () => ({
    buildProjectModal,
    buildEphemeralRetainerToggle,
  }));
  vi.doMock("@/lib/slack/modals/team-member", () => ({ buildTeamMemberModal }));
  vi.doMock("@/lib/slack/modals/multi-detect", () => ({
    reEmitButtonsAfterParentSave: reEmitButtons,
  }));

  vi.doMock("@/lib/runway/operations-reads-clients", () => ({
    getProjectsFiltered,
  }));

  vi.doMock("@/lib/inngest/client", () => ({
    inngest: { send: inngestSend },
  }));

  return {
    proposals,
    proposalUpdates,
    viewsOpen,
    viewsUpdate,
    postEphemeral,
    postMessage,
    inngestSend,
    buildTaskModal,
    buildProjectModal,
    buildTeamMemberModal,
    buildEphemeralRetainerToggle,
    reEmitButtons,
    getProjectsFiltered,
    checkConcurrentProposal,
    recordProposalLifecycleTransition,
  };
}

function makeRequest(
  body: string,
  options?: {
    signature?: string | null;
    timestamp?: string | null;
    signingSecret?: string;
  }
): Request {
  const secret = options?.signingSecret ?? SIGNING_SECRET;
  const ts =
    options && "timestamp" in options
      ? options.timestamp
      : nowTimestamp();
  const sig =
    options?.signature !== undefined
      ? options.signature
      : makeSlackSignature(secret, ts ?? nowTimestamp(), body);

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (sig !== null) headers["x-slack-signature"] = sig;
  if (ts !== null) headers["x-slack-request-timestamp"] = ts;

  return new Request("http://localhost/api/slack/interactivity", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/slack/interactivity — request validation", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("returns 400 when SLACK_SIGNING_SECRET is not configured", async () => {
    setupRouteMocks();
    delete process.env.SLACK_SIGNING_SECRET;
    const { POST } = await import("./route");

    const res = await POST(makeRequest("payload=%7B%7D") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when x-slack-signature header is missing", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const body = encodePayload({ type: "shortcut" });
    const req = makeRequest(body, { signature: null });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when x-slack-request-timestamp header is missing", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const body = encodePayload({ type: "shortcut" });
    const req = makeRequest(body, { timestamp: null });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 401 for invalid signature", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const body = encodePayload({ type: "shortcut" });
    const req = makeRequest(body, { signature: "v0=invalid" });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 for stale timestamp (>5 min)", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const body = encodePayload({ type: "shortcut" });
    const staleTs = (Math.floor(Date.now() / 1000) - 60 * 6).toString(); // 6 min old
    const sig = makeSlackSignature(SIGNING_SECRET, staleTs, body);
    const req = makeRequest(body, { signature: sig, timestamp: staleTs });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 401 for tampered body (signature computed over different body)", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const originalBody = encodePayload({ type: "shortcut" });
    const ts = nowTimestamp();
    const sigOverOriginal = makeSlackSignature(SIGNING_SECRET, ts, originalBody);
    const tamperedBody = encodePayload({ type: "block_actions" });
    const req = makeRequest(tamperedBody, {
      signature: sigOverOriginal,
      timestamp: ts,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when body has no `payload` field", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const body = "not_payload=anything";
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when payload field is malformed JSON", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const body = `payload=${encodeURIComponent("{not valid json")}`;
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown payload.type", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const body = encodePayload({ type: "unknown_type" });
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/slack/interactivity — block_actions routing (scaffold)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("returns 200 for unknown action_id (in-modal interactions handled inline)", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("block-actions-button-click");
    const mutated = mutateFixture(fx, {
      actions: [{ ...(fx as { actions: unknown[] }).actions[0] as object, action_id: "some_inline_action" }],
    } as Partial<Record<string, unknown>>);
    const body = encodePayload(mutated);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
  });

  it("returns 200 when block_actions payload has no actions array", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const body = encodePayload({ type: "block_actions" });
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/slack/interactivity — view_submission routing (scaffold)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("returns 400 for unknown view.callback_id", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("view-submission-task");
    const mutated = mutateFixture(fx, {
      view: { callback_id: "unknown_callback" },
    } as Partial<Record<string, unknown>>);
    const body = encodePayload(mutated);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when view_submission payload has no view", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const body = encodePayload({ type: "view_submission" });
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/slack/interactivity — view_closed routing (Builder 11)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("flips the proposal status to cancelled and posts the Civ-voice thread reply", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_01JKVQX5MNRZF8GH2TKXYZAB7C",
          status: "pending",
          channelId: "C_TEST_001",
          threadTs: "1234.5678",
        }),
      ],
    });
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("view-closed");
    const body = encodePayload(fx);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.proposalUpdates).toHaveLength(1);
    expect(handles.proposalUpdates[0].id).toBe("prop_01JKVQX5MNRZF8GH2TKXYZAB7C");
    expect(handles.proposalUpdates[0].patch.status).toBe("cancelled");
    expect(handles.proposalUpdates[0].patch.statusReason as unknown as string).toBe(
      "user-dismissed",
    );

    expect(handles.postMessage).toHaveBeenCalledTimes(1);
    const postArgs = handles.postMessage.mock.calls[0][0] as {
      channel: string;
      text: string;
      thread_ts?: string;
    };
    expect(postArgs.channel).toBe("C_TEST_001");
    expect(postArgs.thread_ts).toBe("1234.5678");
    expect(postArgs.text).toBe(
      "Got it - dismissed without saving. Run the slash command again or ping me to start over.",
    );
    expect(postArgs.text).not.toMatch(/\u2014/);

    expect(handles.recordProposalLifecycleTransition).toHaveBeenCalledWith(
      "proposal_cancelled",
      expect.any(Object),
    );
  });

  it("is a no-op when proposal is already cancelled (idempotent)", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_01JKVQX5MNRZF8GH2TKXYZAB7C",
          status: "cancelled",
        }),
      ],
    });
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("view-closed");
    const body = encodePayload(fx);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.postMessage).not.toHaveBeenCalled();
    expect(handles.recordProposalLifecycleTransition).not.toHaveBeenCalled();
  });

  it("is a no-op when proposal is already submitted (terminal status)", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_01JKVQX5MNRZF8GH2TKXYZAB7C",
          status: "submitted",
        }),
      ],
    });
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("view-closed");
    const body = encodePayload(fx);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.postMessage).not.toHaveBeenCalled();
  });

  it("returns 200 with no DB write when proposal lookup misses", async () => {
    const handles = setupRouteMocks({ proposals: [] });
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("view-closed");
    const body = encodePayload(fx);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.postMessage).not.toHaveBeenCalled();
  });

  it("returns 200 when private_metadata is missing/malformed (no proposalId to flip)", async () => {
    const handles = setupRouteMocks();
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("view-closed");
    const mutated = mutateFixture(fx, {
      view: { private_metadata: "" },
    } as Partial<Record<string, unknown>>);
    const body = encodePayload(mutated);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.postMessage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Builder 11 — concurrency soft-warn wire-in (open_create_modal)
// ============================================================================

describe("POST /api/slack/interactivity — concurrency soft-warn (Builder 11)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  function payloadForProposal(proposalId: string) {
    const fx = loadFixture<Record<string, unknown>>("block-actions-button-click");
    return mutateFixture(fx, {
      actions: [
        {
          ...(fx as { actions: unknown[] }).actions[0] as object,
          action_id: "open_create_modal",
          value: proposalId,
        },
      ],
    } as Partial<Record<string, unknown>>);
  }

  it("calls checkConcurrentProposal with the right toolName/channel/user/title", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_with_title",
          toolName: "create_week_item",
          kind: "create",
          channelId: "C_TEST_001",
          userSlackId: "U_TEST_001",
          args: JSON.stringify({ title: "Draft homepage hero" }),
        }),
      ],
    });
    const { POST } = await import("./route");
    const body = encodePayload(payloadForProposal("prop_with_title"));
    const req = makeRequest(body);
    await POST(req as never);
    expect(handles.checkConcurrentProposal).toHaveBeenCalledTimes(1);
    const call = handles.checkConcurrentProposal.mock.calls[0][0] as {
      toolName: string;
      fuzzyTitle: string;
      currentUserSlackId: string;
      currentChannelId: string;
    };
    expect(call.toolName).toBe("create_week_item");
    expect(call.fuzzyTitle).toBe("Draft homepage hero");
    expect(call.currentUserSlackId).toBe("U_TEST_001");
    expect(call.currentChannelId).toBe("C_TEST_001");
  });

  it("prepends the soft-warn into multiMatchHint when checkConcurrentProposal returns hasConcurrent=true", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_concurrent",
          toolName: "create_week_item",
          args: JSON.stringify({ title: "Draft homepage hero" }),
        }),
      ],
      concurrentResult: {
        hasConcurrent: true,
        otherUser: "U_OTHER",
        otherTitle: "Draft homepage hero",
        createdAt: new Date(),
      },
    });
    const { POST } = await import("./route");
    const body = encodePayload(payloadForProposal("prop_concurrent"));
    const req = makeRequest(body);
    await POST(req as never);

    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const call = handles.buildTaskModal.mock.calls[0][0] as {
      multiMatchHint?: string;
    };
    expect(call.multiMatchHint).toBeDefined();
    expect(call.multiMatchHint).toContain("Heads up - <@U_OTHER>");
    expect(call.multiMatchHint).toContain("Draft homepage hero");
  });

  it("leaves multiMatchHint untouched when checkConcurrentProposal returns hasConcurrent=false", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_no_concurrent",
          toolName: "create_week_item",
          args: JSON.stringify({ title: "Some Task" }),
        }),
      ],
      // default: { hasConcurrent: false }
    });
    const { POST } = await import("./route");
    const body = encodePayload(payloadForProposal("prop_no_concurrent"));
    const req = makeRequest(body);
    await POST(req as never);

    const call = handles.buildTaskModal.mock.calls[0][0] as {
      multiMatchHint?: string;
    };
    // No fuzzy multi-match was set, no concurrent peer, hint should be undefined.
    expect(call.multiMatchHint).toBeUndefined();
  });

  it("does NOT call checkConcurrentProposal for edit-flow proposals", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_edit",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({ title: "Edit me" }),
        }),
      ],
    });
    const { POST } = await import("./route");
    const body = encodePayload(payloadForProposal("prop_edit"));
    const req = makeRequest(body);
    await POST(req as never);
    expect(handles.checkConcurrentProposal).not.toHaveBeenCalled();
  });
});

describe("POST /api/slack/interactivity — shortcut routing", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("returns 200 on shortcut payload (no-op scaffold)", async () => {
    setupRouteMocks();
    const { POST } = await import("./route");

    const body = encodePayload({
      type: "shortcut",
      callback_id: "any_shortcut",
      trigger_id: "trig_abc",
      user: { id: "U_TEST_001" },
      team: { id: "T_TEST_001" },
    });
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Builder 8 — wired dispatcher tests
// ============================================================================

describe("POST /api/slack/interactivity — open_create_modal (Builder 8)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  function payloadForProposal(proposalId: string) {
    const fx = loadFixture<Record<string, unknown>>("block-actions-button-click");
    return mutateFixture(fx, {
      actions: [
        {
          ...(fx as { actions: unknown[] }).actions[0] as object,
          action_id: "open_create_modal",
          value: proposalId,
        },
      ],
    } as Partial<Record<string, unknown>>);
  }

  it("opens task modal with multiMatchHint set when fuzzy match yields >1 candidate", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_task_with_parent",
          toolName: "create_week_item",
          kind: "create",
          args: JSON.stringify({
            clientSlug: "ag1",
            parentProjectName: "AG1 Pro",
          }),
        }),
      ],
      // Two projects whose names both fuzzy-match "AG1 Pro" at threshold 0.6.
      // Empirically: sorensenDice("AG1 Pro", "AG1 Pro Subscriber 2026") ~= 0.46
      // (sub-threshold), but exact match "AG1 Pro" plus a near-duplicate
      // "AG1 Pro 2026" both clear 0.6 against the input "AG1 Pro".
      projects: [
        { id: "proj_ag1_pro_exact", name: "AG1 Pro" },
        { id: "proj_ag1_pro_2026", name: "AG1 Pro 2026" },
      ],
    });
    const { POST } = await import("./route");

    const body = encodePayload(payloadForProposal("prop_task_with_parent"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.viewsOpen).toHaveBeenCalledTimes(1);
    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const taskCall = handles.buildTaskModal.mock.calls[0][0] as {
      multiMatchHint?: string;
      baselineHint?: string;
      proposalId: string;
      mode: string;
    };
    expect(taskCall.proposalId).toBe("prop_task_with_parent");
    expect(taskCall.mode).toBe("create");
    expect(taskCall.multiMatchHint).toBeTruthy();
    expect(taskCall.multiMatchHint).toMatch(/AG1/);
    expect(taskCall.baselineHint).toBeTruthy();
  });

  it("opens task modal with multiMatchHint=undefined when only 1 candidate matches", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_task_single",
          toolName: "create_week_item",
          args: JSON.stringify({
            clientSlug: "ag1",
            parentProjectName: "Landing Page Copy",
          }),
        }),
      ],
      projects: [
        { id: "proj_landing", name: "Landing Page Copy" },
        { id: "proj_other", name: "Completely Unrelated Engagement" },
      ],
    });
    const { POST } = await import("./route");

    const body = encodePayload(payloadForProposal("prop_task_single"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const taskCall = handles.buildTaskModal.mock.calls[0][0] as {
      multiMatchHint?: string;
      baselineHint?: string;
    };
    expect(taskCall.multiMatchHint).toBeUndefined();
    // Baseline hint still on - parent picker is still rendered.
    expect(taskCall.baselineHint).toBeTruthy();
  });

  it("opens task modal with both hints undefined when no parent name in args", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_task_no_parent",
          toolName: "create_week_item",
          args: JSON.stringify({ clientSlug: "ag1" }),
        }),
      ],
    });
    const { POST } = await import("./route");

    const body = encodePayload(payloadForProposal("prop_task_no_parent"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    const taskCall = handles.buildTaskModal.mock.calls[0][0] as {
      multiMatchHint?: string;
      baselineHint?: string;
    };
    expect(taskCall.multiMatchHint).toBeUndefined();
    expect(taskCall.baselineHint).toBeUndefined();
    // Fuzzy match should NOT have been queried because there's no parent name.
    expect(handles.getProjectsFiltered).not.toHaveBeenCalled();
  });

  it("opens project modal in retainer mode with both hints suppressed", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_retainer",
          toolName: "create_project",
          args: JSON.stringify({
            clientSlug: "ag1",
            isRetainer: true,
            // Even if a parent name slipped in, retainer mode wins.
            parentRetainerName: "Whatever",
          }),
        }),
      ],
      projects: [
        { id: "proj_a", name: "Whatever Retainer" },
        { id: "proj_b", name: "Whatever Else" },
      ],
    });
    const { POST } = await import("./route");

    const body = encodePayload(payloadForProposal("prop_retainer"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.buildProjectModal).toHaveBeenCalledTimes(1);
    const call = handles.buildProjectModal.mock.calls[0][0] as {
      retainerMode?: boolean;
      multiMatchHint?: string;
      baselineHint?: string;
    };
    expect(call.retainerMode).toBe(true);
    expect(call.multiMatchHint).toBeUndefined();
    expect(call.baselineHint).toBeUndefined();
  });

  it("routes team-member tool to buildTeamMemberModal (no parent picker)", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_tm",
          toolName: "create_team_member",
          args: JSON.stringify({ fullName: "Lane Lopez" }),
        }),
      ],
    });
    const { POST } = await import("./route");

    const body = encodePayload(payloadForProposal("prop_tm"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.buildTeamMemberModal).toHaveBeenCalledTimes(1);
    expect(handles.buildTaskModal).not.toHaveBeenCalled();
    expect(handles.buildProjectModal).not.toHaveBeenCalled();
  });

  it("posts ephemeral and skips views.open when proposal is expired", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_expired",
          status: "pending",
          expiresAt: new Date(Date.now() - 1000), // 1 second ago
        }),
      ],
    });
    const { POST } = await import("./route");

    const body = encodePayload(payloadForProposal("prop_expired"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.viewsOpen).not.toHaveBeenCalled();
    expect(handles.postEphemeral).toHaveBeenCalledTimes(1);
  });

  it("posts ephemeral and skips views.open when proposal status is submitted", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({ id: "prop_submitted", status: "submitted" }),
      ],
    });
    const { POST } = await import("./route");

    const body = encodePayload(payloadForProposal("prop_submitted"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(handles.viewsOpen).not.toHaveBeenCalled();
    expect(handles.postEphemeral).toHaveBeenCalledTimes(1);
  });

  it("returns 200 + posts ephemeral when proposal lookup misses", async () => {
    const handles = setupRouteMocks({ proposals: [] });
    const { POST } = await import("./route");

    const body = encodePayload(payloadForProposal("prop_does_not_exist"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(handles.viewsOpen).not.toHaveBeenCalled();
    expect(handles.postEphemeral).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/slack/interactivity — is_retainer_checkbox (Builder 8)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("calls views.update with the rebuilt view (response_action: update is invalid for block_actions)", async () => {
    // Slack honors response_action: "update" only for view_submission. For
    // block_actions on a modal, the route must ack 200 with no body and
    // call views.update separately. Asserting on the API call, not the
    // HTTP body, is the only way to catch the silent-no-op bug operator
    // hit on 2026-05-04 (checked the box, view never flipped to retainer).
    const handles = setupRouteMocks();
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("block-actions-checkbox-toggle");
    const body = encodePayload(fx);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(handles.buildEphemeralRetainerToggle).toHaveBeenCalledTimes(1);
    expect(handles.viewsUpdate).toHaveBeenCalledTimes(1);

    const updateCall = handles.viewsUpdate.mock.calls[0][0] as {
      view_id: unknown;
      view: { type?: string };
    };
    expect(updateCall.view_id).toBeDefined();
    expect(updateCall.view).toBeDefined();
    expect(updateCall.view.type).toBe("modal");
  });

  it("swallows views.update hash_conflict errors gracefully", async () => {
    const handles = setupRouteMocks();
    handles.viewsUpdate.mockRejectedValueOnce(new Error("hash_conflict"));
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("block-actions-checkbox-toggle");
    const body = encodePayload(fx);
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/slack/interactivity — task_button_disabled (Builder 8)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  function payloadForDisabled(proposalId: string) {
    const fx = loadFixture<Record<string, unknown>>("block-actions-button-click");
    return mutateFixture(fx, {
      actions: [
        {
          ...(fx as { actions: unknown[] }).actions[0] as object,
          action_id: "task_button_disabled",
          value: proposalId,
        },
      ],
    } as Partial<Record<string, unknown>>);
  }

  it("posts ephemeral 'save the project first' when resolvedProjectId is null", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({ id: "prop_disabled_task", resolvedProjectId: null }),
      ],
    });
    const { POST } = await import("./route");

    const body = encodePayload(payloadForDisabled("prop_disabled_task"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(handles.postEphemeral).toHaveBeenCalledTimes(1);
    expect(handles.viewsOpen).not.toHaveBeenCalled();
  });

  it("returns 200 (no error, no ephemeral) when resolvedProjectId is set (defensive log only)", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_already_resolved",
          resolvedProjectId: "proj_was_saved",
        }),
      ],
    });
    const { POST } = await import("./route");

    const body = encodePayload(payloadForDisabled("prop_already_resolved"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    // No views.open, no ephemeral - defensive branch logs and acks.
    expect(handles.viewsOpen).not.toHaveBeenCalled();
    expect(handles.postEphemeral).not.toHaveBeenCalled();
  });
});

describe("POST /api/slack/interactivity — target_entity_picker (Builder 8)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("calls views.update and persists targetEntityId/Type on the proposal row", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_disambig",
          kind: "edit",
          toolName: "update_project",
          targetEntityId: null,
          targetEntityType: null,
        }),
      ],
    });
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("block-actions-button-click");
    const mutated = mutateFixture(fx, {
      actions: [
        {
          ...(fx as { actions: unknown[] }).actions[0] as object,
          action_id: "target_entity_picker",
          // selected_option carries the chosen entity id.
          selected_option: { value: "proj_picked_one" },
        },
      ],
      view: {
        id: "V_TEST_001",
        hash: "hash_abc",
        callback_id: "runway_edit_project",
        private_metadata: JSON.stringify({ proposalId: "prop_disambig" }),
      },
    } as Partial<Record<string, unknown>>);

    const body = encodePayload(mutated);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.viewsUpdate).toHaveBeenCalledTimes(1);
    expect(handles.proposalUpdates).toHaveLength(1);
    expect(handles.proposalUpdates[0].id).toBe("prop_disambig");
    expect(handles.proposalUpdates[0].patch.targetEntityId).toBe("proj_picked_one");
    expect(handles.proposalUpdates[0].patch.targetEntityType).toBe("project");
  });
});

describe("POST /api/slack/interactivity — date_type_radio (Issue 3)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  function buildDateTypePayload(opts: {
    newType: "single" | "range";
    callbackId?: string;
    proposalId?: string;
    stateValues?: Record<string, Record<string, unknown>>;
  }) {
    return {
      type: "block_actions",
      team: { id: "T_TEST_TEAM" },
      user: { id: "U_TEST_USER", team_id: "T_TEST_TEAM" },
      trigger_id: "trigger_xyz",
      response_url: null,
      channel: { id: "C_TEST_001" },
      view: {
        id: "V_TEST_DT_001",
        hash: "hash_v1",
        callback_id: opts.callbackId ?? "runway_new_task",
        private_metadata: JSON.stringify({
          proposalId: opts.proposalId ?? "prop_dt_001",
        }),
        state: { values: opts.stateValues ?? {} },
      },
      actions: [
        {
          action_id: "date_type_radio",
          block_id: "date_type_block",
          type: "radio_buttons",
          selected_option: { value: opts.newType },
        },
      ],
    };
  }

  it("toggles to range mode and re-renders with views.update + correct view_id/hash", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_dt_001",
          toolName: "create_week_item",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildDateTypePayload({ newType: "range" });
    const body = encodePayload(payload);
    const res = await POST(makeRequest(body) as never);
    expect(res.status).toBe(200);

    expect(handles.viewsUpdate).toHaveBeenCalledTimes(1);
    const call = handles.viewsUpdate.mock.calls[0][0] as {
      view_id: string;
      hash?: string;
    };
    expect(call.view_id).toBe("V_TEST_DT_001");
    expect(call.hash).toBe("hash_v1");
    // Verify buildTaskModal was called with the new dateType.
    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const cv = handles.buildTaskModal.mock.calls[0][0] as {
      currentValues?: { dateType?: string };
    };
    expect(cv.currentValues?.dateType).toBe("range");
  });

  it("toggles to single mode and passes dateType=single to view builder", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_dt_002",
          toolName: "create_week_item",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildDateTypePayload({
      newType: "single",
      proposalId: "prop_dt_002",
      stateValues: {
        date_type_block: {
          date_type_radio: { selected_option: { value: "range" } },
        },
        start_date_block: {
          start_date_picker: { selected_date: "2026-05-04" },
        },
        end_date_block: {
          end_date_picker: { selected_date: "2026-05-09" },
        },
      },
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.viewsUpdate).toHaveBeenCalledTimes(1);
    const cv = handles.buildTaskModal.mock.calls[0][0] as {
      currentValues?: {
        dateType?: string;
        startDate?: string;
        endDate?: string;
      };
    };
    expect(cv.currentValues?.dateType).toBe("single");
    // Existing range picks survive the toggle so the user can flip back
    // without losing them.
    expect(cv.currentValues?.startDate).toBe("2026-05-04");
    expect(cv.currentValues?.endDate).toBe("2026-05-09");
  });

  // Operator's explicit Issue 3 requirement: views.update reconstruction
  // must preserve every other in-flight field. UX-break risk if missed.
  it("preserves Title, Client, Parent, Category, Owner, Resources, and Notes across radio toggle", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_dt_003",
          toolName: "create_week_item",
        }),
      ],
    });
    const { POST } = await import("./route");

    const stateValues = {
      client_block: {
        client_select: { selected_option: { value: "client_xyz" } },
      },
      parent_project_block: {
        parent_project_select: { selected_option: { value: "proj_q3_redesign" } },
      },
      title_block: { title_input: { value: "Concept Writeup" } },
      category_block: {
        category_select: { selected_option: { value: "delivery" } },
      },
      date_type_block: {
        date_type_radio: { selected_option: { value: "single" } },
      },
      date_block: { date_picker: { selected_date: "2026-05-08" } },
      owner_block: {
        owner_select: { selected_option: { value: "tm_lane_id" } },
      },
      resources_block_0: {
        resources_role_0: { selected_option: { value: "CD" } },
      },
      resources_name_block_0: {
        resources_name_0: {
          selected_option: { text: { text: "Lane Carter" }, value: "tm_lane_id" },
        },
      },
      notes_block: { notes_input: { value: "Draft v1" } },
    };

    const payload = buildDateTypePayload({
      newType: "range",
      proposalId: "prop_dt_003",
      stateValues,
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const cv = handles.buildTaskModal.mock.calls[0][0] as {
      currentValues?: Record<string, unknown>;
      mode?: string;
    };
    expect(cv.mode).toBe("create");
    expect(cv.currentValues?.title).toBe("Concept Writeup");
    expect(cv.currentValues?.notes).toBe("Draft v1");
    expect(cv.currentValues?.category).toBe("delivery");
    expect(cv.currentValues?.clientId).toBe("client_xyz");
    expect(cv.currentValues?.projectId).toBe("proj_q3_redesign");
    expect(cv.currentValues?.owner).toBe("tm_lane_id");
    expect(cv.currentValues?.date).toBe("2026-05-08");
    // Resources rebuilt as "Role: Name" string array — buildResourcesBlocks
    // splits on the colon to repopulate the row.
    expect(cv.currentValues?.resources).toEqual(["CD: Lane Carter"]);
    // dateType flipped to the new value from the radio.
    expect(cv.currentValues?.dateType).toBe("range");
  });

  it("ignores date_type_radio when callback_id is not a task modal", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_dt_004",
          toolName: "create_project",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildDateTypePayload({
      newType: "range",
      callbackId: "runway_new_project",
      proposalId: "prop_dt_004",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
  });

  it("swallows views.update hash_conflict errors gracefully", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_dt_005",
          toolName: "create_week_item",
        }),
      ],
    });
    handles.viewsUpdate.mockRejectedValueOnce(new Error("hash_conflict"));
    const { POST } = await import("./route");

    const payload = buildDateTypePayload({
      newType: "range",
      proposalId: "prop_dt_005",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    // Handler must still ack 200 even when Slack rejects the update.
    expect(res.status).toBe(200);
  });
});

// ----------------------------------------------------------------------------
// Issue 1: client_select cascade. Slack input-block external_select state.values
// does NOT propagate into block_suggestion payloads, so the Parent picker's
// options-provider cannot read clientId from state.values. The Client picker
// fires block_actions on every pick (dispatch_action: true); the handler
// rebuilds the modal via views.update with clientId in private_metadata.
// ----------------------------------------------------------------------------

describe("POST /api/slack/interactivity — client_select cascade (Issue 1)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  function buildClientSelectPayload(opts: {
    newClientId: string;
    callbackId?: string;
    proposalId?: string;
    privateMetadata?: string;
    stateValues?: Record<string, Record<string, unknown>>;
  }) {
    const proposalId = opts.proposalId ?? "prop_cs_001";
    const meta =
      opts.privateMetadata ?? JSON.stringify({ proposalId });
    return {
      type: "block_actions",
      team: { id: "T_TEST_TEAM" },
      user: { id: "U_TEST_USER", team_id: "T_TEST_TEAM" },
      trigger_id: "trigger_cs",
      response_url: null,
      channel: { id: "C_TEST_001" },
      view: {
        id: "V_TEST_CS_001",
        hash: "hash_cs_v1",
        callback_id: opts.callbackId ?? "runway_new_task",
        private_metadata: meta,
        state: { values: opts.stateValues ?? {} },
      },
      actions: [
        {
          action_id: "client_select",
          block_id: "client_block",
          type: "external_select",
          selected_option: { value: opts.newClientId },
        },
      ],
    };
  }

  it("ignores client_select on Team Member callback (no parent cascade)", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_cs_001",
          toolName: "create_team_member",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildClientSelectPayload({
      newClientId: "client_zzz",
      callbackId: "runway_new_team_member",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
  });

  it("returns 200 without rebuild when proposal cannot be loaded", async () => {
    const handles = setupRouteMocks({ proposals: [] });
    const { POST } = await import("./route");

    const payload = buildClientSelectPayload({ newClientId: "client_zzz" });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
  });

  it("Task create: rebuilds via views.update with clientId in currentValues and projectId cleared", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_cs_task_create",
          toolName: "create_week_item",
          kind: "create",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildClientSelectPayload({
      newClientId: "client_new_42",
      callbackId: "runway_new_task",
      proposalId: "prop_cs_task_create",
      stateValues: {
        // User has previously picked a stale parent that is no longer valid
        // for the new client.
        parent_project_block: {
          parent_project_select: { selected_option: { value: "proj_stale" } },
        },
      },
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.viewsUpdate).toHaveBeenCalledTimes(1);
    const call = handles.viewsUpdate.mock.calls[0][0] as {
      view_id: string;
      hash?: string;
    };
    expect(call.view_id).toBe("V_TEST_CS_001");
    expect(call.hash).toBe("hash_cs_v1");

    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const params = handles.buildTaskModal.mock.calls[0][0] as {
      mode?: string;
      currentValues?: Record<string, unknown>;
    };
    expect(params.mode).toBe("create");
    expect(params.currentValues?.clientId).toBe("client_new_42");
    expect(params.currentValues?.projectId).toBeUndefined();
  });

  it("Task edit: cascade fires on runway_edit_task and clears stale parent", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_cs_task_edit",
          toolName: "create_week_item",
          kind: "edit",
          targetEntityType: "week_item",
          targetEntityId: "wi_existing",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildClientSelectPayload({
      newClientId: "client_edit_43",
      callbackId: "runway_edit_task",
      proposalId: "prop_cs_task_edit",
      privateMetadata: JSON.stringify({
        proposalId: "prop_cs_task_edit",
        clientId: "client_old_99",
      }),
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const params = handles.buildTaskModal.mock.calls[0][0] as {
      mode?: string;
      currentValues?: Record<string, unknown>;
    };
    expect(params.mode).toBe("edit");
    expect(params.currentValues?.clientId).toBe("client_edit_43");
    expect(params.currentValues?.projectId).toBeUndefined();
  });

  it("Project create non-retainer: rebuilds with retainerMode=false and parentProjectId cleared", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_cs_proj_create",
          toolName: "create_project",
          kind: "create",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildClientSelectPayload({
      newClientId: "client_new_44",
      callbackId: "runway_new_project",
      proposalId: "prop_cs_proj_create",
      privateMetadata: JSON.stringify({
        proposalId: "prop_cs_proj_create",
        retainerMode: false,
      }),
      stateValues: {
        parent_retainer_block: {
          parent_retainer_picker: { selected_option: { value: "retainer_stale" } },
        },
      },
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildProjectModal).toHaveBeenCalledTimes(1);
    const params = handles.buildProjectModal.mock.calls[0][0] as {
      mode?: string;
      retainerMode?: boolean;
      currentValues?: Record<string, unknown>;
    };
    expect(params.mode).toBe("create");
    expect(params.retainerMode).toBe(false);
    expect(params.currentValues?.clientId).toBe("client_new_44");
    expect(params.currentValues?.parentProjectId).toBeUndefined();
  });

  it("Project edit non-retainer: cascade fires on runway_edit_project", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_cs_proj_edit",
          toolName: "create_project",
          kind: "edit",
          targetEntityType: "project",
          targetEntityId: "proj_existing",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildClientSelectPayload({
      newClientId: "client_edit_45",
      callbackId: "runway_edit_project",
      proposalId: "prop_cs_proj_edit",
      privateMetadata: JSON.stringify({
        proposalId: "prop_cs_proj_edit",
        retainerMode: false,
        clientId: "client_old_88",
      }),
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildProjectModal).toHaveBeenCalledTimes(1);
    const params = handles.buildProjectModal.mock.calls[0][0] as {
      mode?: string;
      retainerMode?: boolean;
      currentValues?: Record<string, unknown>;
    };
    expect(params.mode).toBe("edit");
    expect(params.retainerMode).toBe(false);
    expect(params.currentValues?.clientId).toBe("client_edit_45");
    expect(params.currentValues?.parentProjectId).toBeUndefined();
  });

  it("Project create retainer: cascade preserves retainerMode=true and does not touch parentProjectId", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_cs_ret_create",
          toolName: "create_project",
          kind: "create",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildClientSelectPayload({
      newClientId: "client_ret_46",
      callbackId: "runway_new_project",
      proposalId: "prop_cs_ret_create",
      privateMetadata: JSON.stringify({
        proposalId: "prop_cs_ret_create",
        retainerMode: true,
      }),
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildProjectModal).toHaveBeenCalledTimes(1);
    const params = handles.buildProjectModal.mock.calls[0][0] as {
      mode?: string;
      retainerMode?: boolean;
      currentValues?: Record<string, unknown>;
    };
    expect(params.mode).toBe("create");
    expect(params.retainerMode).toBe(true);
    expect(params.currentValues?.clientId).toBe("client_ret_46");
    // Retainer mode renders no parent picker, so the handler does not touch
    // parentProjectId. Whatever the extractor pulled from state stays.
    expect(
      Object.prototype.hasOwnProperty.call(
        params.currentValues ?? {},
        "parentProjectId",
      ) && params.currentValues?.parentProjectId === undefined,
    ).toBe(false);
  });

  it("Project edit retainer: cascade preserves retainerMode=true on runway_edit_project", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_cs_ret_edit",
          toolName: "create_project",
          kind: "edit",
          targetEntityType: "project",
          targetEntityId: "proj_existing_retainer",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildClientSelectPayload({
      newClientId: "client_ret_47",
      callbackId: "runway_edit_project",
      proposalId: "prop_cs_ret_edit",
      privateMetadata: JSON.stringify({
        proposalId: "prop_cs_ret_edit",
        retainerMode: true,
        clientId: "client_old_77",
      }),
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildProjectModal).toHaveBeenCalledTimes(1);
    const params = handles.buildProjectModal.mock.calls[0][0] as {
      mode?: string;
      retainerMode?: boolean;
      currentValues?: Record<string, unknown>;
    };
    expect(params.mode).toBe("edit");
    expect(params.retainerMode).toBe(true);
    expect(params.currentValues?.clientId).toBe("client_ret_47");
  });

  it("preserves Title, Category, Owner, Resources, Notes, dateType, and dates across the rebuild", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_cs_preserve",
          toolName: "create_week_item",
        }),
      ],
    });
    const { POST } = await import("./route");

    const stateValues = {
      title_block: { title_input: { value: "Concept Writeup" } },
      category_block: {
        category_select: { selected_option: { value: "delivery" } },
      },
      date_type_block: {
        date_type_radio: { selected_option: { value: "single" } },
      },
      date_block: { date_picker: { selected_date: "2026-05-08" } },
      owner_block: {
        owner_select: { selected_option: { value: "tm_lane_id" } },
      },
      resources_block_0: {
        resources_role_0: { selected_option: { value: "CD" } },
      },
      resources_name_block_0: {
        resources_name_0: {
          selected_option: { text: { text: "Lane Carter" }, value: "tm_lane_id" },
        },
      },
      notes_block: { notes_input: { value: "Draft v1" } },
    };

    const payload = buildClientSelectPayload({
      newClientId: "client_new_99",
      proposalId: "prop_cs_preserve",
      stateValues,
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const cv = handles.buildTaskModal.mock.calls[0][0] as {
      currentValues?: Record<string, unknown>;
    };
    expect(cv.currentValues?.title).toBe("Concept Writeup");
    expect(cv.currentValues?.notes).toBe("Draft v1");
    expect(cv.currentValues?.category).toBe("delivery");
    expect(cv.currentValues?.owner).toBe("tm_lane_id");
    expect(cv.currentValues?.dateType).toBe("single");
    expect(cv.currentValues?.date).toBe("2026-05-08");
    expect(cv.currentValues?.resources).toEqual(["CD: Lane Carter"]);
    // New client overrides the old; old parent cleared.
    expect(cv.currentValues?.clientId).toBe("client_new_99");
    expect(cv.currentValues?.projectId).toBeUndefined();
  });

  it("swallows views.update hash_conflict errors gracefully", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_cs_hash",
          toolName: "create_week_item",
        }),
      ],
    });
    handles.viewsUpdate.mockRejectedValueOnce(new Error("hash_conflict"));
    const { POST } = await import("./route");

    const payload = buildClientSelectPayload({
      newClientId: "client_zz",
      proposalId: "prop_cs_hash",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/slack/interactivity — view_submission dispatch (Builder 8)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it.each([
    "runway_new_task",
    "runway_new_project",
    "runway_new_team_member",
    "runway_edit_task",
    "runway_edit_project",
    "runway_edit_team_member",
  ])("dispatches inngest event slack-modal/submit for callback_id=%s and returns 200", async (callbackId) => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_01JKVQX5MNRZF8GH2TKXYZAB7C",
          channelId: "C_TEST_001",
          threadTs: null,
        }),
      ],
    });
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("view-submission-task");
    const mutated = mutateFixture(fx, {
      view: { callback_id: callbackId },
    } as Partial<Record<string, unknown>>);
    const body = encodePayload(mutated);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.inngestSend).toHaveBeenCalledTimes(1);
    const event = handles.inngestSend.mock.calls[0][0] as {
      name: string;
      data: Record<string, unknown>;
    };
    expect(event.name).toBe("slack-modal/submit");
    expect(event.data.proposalId).toBe("prop_01JKVQX5MNRZF8GH2TKXYZAB7C");
    expect(event.data.modalCallbackId).toBe(callbackId);
    expect(event.data.userId).toBe("U_TEST_001");
    expect(event.data.teamId).toBe("T_TEST_001");
    expect(event.data.channelId).toBe("C_TEST_001");
    expect(event.data.threadTs).toBeNull();
    expect(typeof event.data.submittedAt).toBe("string");
    expect(event.data.stateValues).toBeDefined();
  });

  it("returns 400 + does not dispatch when private_metadata is missing proposalId", async () => {
    const handles = setupRouteMocks();
    const { POST } = await import("./route");

    const fx = loadFixture<Record<string, unknown>>("view-submission-task");
    const mutated = mutateFixture(fx, {
      view: { private_metadata: "" },
    } as Partial<Record<string, unknown>>);
    const body = encodePayload(mutated);
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    expect(handles.inngestSend).not.toHaveBeenCalled();
  });
});
