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
 *   - block_actions/multi_match_candidate_select -> views.update + persist
 *     targetEntityId/Type (Wave 2 / Wave 6); replaced legacy
 *     target_entity_picker handler removed in Fix 6.4
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
  loadEntityById: ReturnType<typeof vi.fn>;
  getClientNameById: ReturnType<typeof vi.fn>;
  getProjectsForClient: ReturnType<typeof vi.fn>;
}

function setupRouteMocks(opts?: {
  proposals?: MockProposal[];
  projects?: Array<{ id: string; name: string }>;
  concurrentResult?:
    | { hasConcurrent: false }
    | { hasConcurrent: true; otherUser: string; otherTitle: string; createdAt: Date };
  /**
   * Map of entity id -> row for the loadEntityById shared module mock. Used
   * by the multi_match_candidate_select tests; other tests don't touch the
   * helper so the default empty map is fine.
   */
  entitiesById?: Record<string, Record<string, unknown> | null>;
  /**
   * Map of clientId -> client name for the getClientNameById mock used by
   * handleMultiMatchCandidateSelect to resolve picker labels.
   */
  clientNamesById?: Record<string, string>;
  /**
   * Map of clientId -> projects-for-client list. Used by the
   * getProjectsForClient mock in handleMultiMatchCandidateSelect to look up
   * projectName for the parent picker label.
   */
  projectsByClient?: Record<string, Array<{ id: string; name: string }>>;
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

  const entitiesById = opts?.entitiesById ?? {};
  const loadEntityById = vi.fn(async (_kind: string, id: string) => {
    if (Object.prototype.hasOwnProperty.call(entitiesById, id)) {
      return entitiesById[id];
    }
    return null;
  });

  const clientNamesById = opts?.clientNamesById ?? {};
  const getClientNameById = vi.fn(async (clientId: string | null) => {
    if (!clientId) return undefined;
    return clientNamesById[clientId];
  });

  const projectsByClient = opts?.projectsByClient ?? {};
  const getProjectsForClient = vi.fn(async (clientId: string) => {
    return projectsByClient[clientId] ?? [];
  });

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

  vi.doMock("@/lib/slack/load-entity-by-id", () => ({ loadEntityById }));

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

  vi.doMock("@/lib/runway/operations-utils", () => ({
    getClientNameById,
    getProjectsForClient,
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
    loadEntityById,
    getClientNameById,
    getProjectsForClient,
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

  it("rejects open_create_modal when clicking user does not own the proposal", async () => {
    // Q4 / Bug fix: handleOpenCreateModal must verify the clicker matches
    // proposal.userSlackId. In shared channels another user could otherwise
    // open + submit someone else's draft; the submit-side mismatch path then
    // marks it `failed` and invalidates the original author's draft.
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_other_user",
          toolName: "create_week_item",
          userSlackId: "U_OTHER_USER",
          args: JSON.stringify({ clientSlug: "ag1" }),
        }),
      ],
    });
    const { POST } = await import("./route");

    // Fixture's payload.user.id is "U_TEST_001" but the proposal belongs to
    // U_OTHER_USER -> should fail closed at modal-open time.
    const body = encodePayload(payloadForProposal("prop_other_user"));
    const req = makeRequest(body);
    const res = await POST(req as never);
    expect(res.status).toBe(200);

    expect(handles.viewsOpen).not.toHaveBeenCalled();
    expect(handles.buildTaskModal).not.toHaveBeenCalled();
    expect(handles.postEphemeral).toHaveBeenCalled();
    const ephemeralCall = handles.postEphemeral.mock.calls[0][0] as { text: string };
    expect(ephemeralCall.text).toMatch(/belongs to someone else/i);
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

// Wave 6 / Fix 6.4: legacy target_entity_picker action_id was unreachable.
// Edit-flow disambiguation is owned by multi_match_candidate_select (Wave 2)
// across the whole stack. The dispatcher case + handler + this test were
// dead code and have been removed. The defensive guards (terminal-state,
// ownership, idempotency, try/catch on row load) live in the surviving
// handler tested below.

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

// ----------------------------------------------------------------------------
// Wave 2 - multi_match_candidate_select handler. Wave 1 added the picker block
// in all three edit modals; this dispatcher transitions the modal from the
// disambiguation phase to the prefilled-edit phase when the user picks a
// candidate.
// ----------------------------------------------------------------------------

describe("POST /api/slack/interactivity - multi_match_candidate_select (Wave 2)", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  function buildPickerPayload(opts: {
    selectedId: string;
    callbackId?: string;
    proposalId?: string;
    viewId?: string;
    viewHash?: string;
  }) {
    const proposalId = opts.proposalId ?? "prop_mm_001";
    return {
      type: "block_actions",
      team: { id: "T_TEST_TEAM" },
      // Default matches makeProposal's default userSlackId so the
      // ownership guard passes. Cross-user assertions live in the
      // holdout describe.
      user: { id: "U_TEST_001", team_id: "T_TEST_TEAM" },
      trigger_id: "trigger_mm",
      response_url: null,
      channel: { id: "C_TEST_001" },
      view: {
        id: opts.viewId ?? "V_TEST_MM_001",
        hash: opts.viewHash ?? "hash_mm_v1",
        callback_id: opts.callbackId ?? "runway_edit_task",
        private_metadata: JSON.stringify({ proposalId }),
        state: { values: {} },
      },
      actions: [
        {
          action_id: "multi_match_candidate_select",
          block_id: "multi_match_candidate_block",
          type: "static_select",
          selected_option: { value: opts.selectedId },
        },
      ],
    };
  }

  it("Task happy path: loads the week_item row, persists targetEntityId, rebuilds prefilled view", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_mm_task",
          kind: "edit",
          toolName: "update_week_item",
          targetEntityId: null,
          targetEntityType: null,
          args: JSON.stringify({
            multiMatchQuery: "Concept",
            candidates: [
              { id: "wi_one", label: "Concept Writeup" },
              { id: "wi_two", label: "Concept Refresh" },
            ],
          }),
        }),
      ],
      entitiesById: {
        wi_one: {
          id: "wi_one",
          title: "Concept Writeup",
          clientId: "client_ag1",
          projectId: "proj_q3",
          category: "delivery",
        },
      },
      clientNamesById: { client_ag1: "AG1" },
      projectsByClient: {
        client_ag1: [{ id: "proj_q3", name: "Q3 Brand Refresh" }],
      },
    });
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "wi_one",
      callbackId: "runway_edit_task",
      proposalId: "prop_mm_task",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.loadEntityById).toHaveBeenCalledWith("task", "wi_one");

    expect(handles.proposalUpdates).toHaveLength(1);
    expect(handles.proposalUpdates[0].id).toBe("prop_mm_task");
    expect(handles.proposalUpdates[0].patch.targetEntityId).toBe("wi_one");
    expect(handles.proposalUpdates[0].patch.targetEntityType).toBe("week_item");

    expect(handles.viewsUpdate).toHaveBeenCalledTimes(1);
    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const call = handles.buildTaskModal.mock.calls[0][0] as {
      mode?: string;
      proposalId?: string;
      currentValues?: Record<string, unknown>;
      multiMatchCandidates?: unknown;
      errorBlock?: unknown;
    };
    expect(call.mode).toBe("edit");
    expect(call.proposalId).toBe("prop_mm_task");
    expect(call.currentValues?.title).toBe("Concept Writeup");
    expect(call.currentValues?.clientId).toBe("client_ag1");
    expect(call.currentValues?.projectId).toBe("proj_q3");
    // Bug A: resolved names for picker labels (clientId/projectId stay as raw FKs).
    expect(call.currentValues?.clientName).toBe("AG1");
    expect(call.currentValues?.projectName).toBe("Q3 Brand Refresh");
    expect(call.multiMatchCandidates).toBeUndefined();
    expect(call.errorBlock).toBeUndefined();
  });

  it("Project happy path: loads the project row, persists targetEntityType=project", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_mm_proj",
          kind: "edit",
          toolName: "update_project",
          targetEntityId: null,
          targetEntityType: null,
          args: JSON.stringify({
            multiMatchQuery: "Brand",
            candidates: [
              { id: "proj_brand_a", label: "Brand Refresh" },
              { id: "proj_brand_b", label: "Brand Strategy" },
            ],
          }),
        }),
      ],
      entitiesById: {
        proj_brand_a: {
          id: "proj_brand_a",
          name: "Brand Refresh",
          clientId: "client_xyz",
          parentProjectId: "proj_retainer_xyz",
          status: "in-production",
        },
      },
      clientNamesById: { client_xyz: "XYZ Co" },
      projectsByClient: {
        client_xyz: [
          { id: "proj_retainer_xyz", name: "TEST Retainer Verify" },
          { id: "proj_brand_a", name: "Brand Refresh" },
        ],
      },
    });
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "proj_brand_a",
      callbackId: "runway_edit_project",
      proposalId: "prop_mm_proj",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.loadEntityById).toHaveBeenCalledWith("project", "proj_brand_a");

    expect(handles.proposalUpdates).toHaveLength(1);
    expect(handles.proposalUpdates[0].patch.targetEntityId).toBe("proj_brand_a");
    expect(handles.proposalUpdates[0].patch.targetEntityType).toBe("project");

    expect(handles.viewsUpdate).toHaveBeenCalledTimes(1);
    expect(handles.buildProjectModal).toHaveBeenCalledTimes(1);
    const call = handles.buildProjectModal.mock.calls[0][0] as {
      mode?: string;
      currentValues?: Record<string, unknown>;
      multiMatchCandidates?: unknown;
    };
    expect(call.mode).toBe("edit");
    expect(call.currentValues?.name).toBe("Brand Refresh");
    expect(call.currentValues?.clientId).toBe("client_xyz");
    // Bug A: resolved names for picker labels (FK columns stay raw).
    expect(call.currentValues?.clientName).toBe("XYZ Co");
    expect(call.currentValues?.parentProjectId).toBe("proj_retainer_xyz");
    expect(call.currentValues?.projectName).toBe("TEST Retainer Verify");
    expect(call.multiMatchCandidates).toBeUndefined();
  });

  it("Team-member happy path: loads the team_member row, persists targetEntityType=team_member", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_mm_tm",
          kind: "edit",
          toolName: "update_team_member",
          targetEntityId: null,
          targetEntityType: null,
          args: JSON.stringify({
            multiMatchQuery: "Lane",
            candidates: [
              { id: "tm_lane_one", label: "Lane Carter" },
              { id: "tm_lane_two", label: "Lane Lopez" },
            ],
          }),
        }),
      ],
      entitiesById: {
        tm_lane_one: {
          id: "tm_lane_one",
          fullName: "Lane Carter",
          clientId: "client_ag1",
          roleCategory: "creative",
        },
      },
    });
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "tm_lane_one",
      callbackId: "runway_edit_team_member",
      proposalId: "prop_mm_tm",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.loadEntityById).toHaveBeenCalledWith("team-member", "tm_lane_one");

    expect(handles.proposalUpdates).toHaveLength(1);
    expect(handles.proposalUpdates[0].patch.targetEntityId).toBe("tm_lane_one");
    expect(handles.proposalUpdates[0].patch.targetEntityType).toBe("team_member");

    expect(handles.viewsUpdate).toHaveBeenCalledTimes(1);
    expect(handles.buildTeamMemberModal).toHaveBeenCalledTimes(1);
    const call = handles.buildTeamMemberModal.mock.calls[0][0] as {
      mode?: string;
      currentValues?: Record<string, unknown>;
      multiMatchCandidates?: unknown;
    };
    expect(call.mode).toBe("edit");
    expect(call.currentValues?.fullName).toBe("Lane Carter");
    expect(call.multiMatchCandidates).toBeUndefined();
  });

  it("Race: loadEntityById returns null, modal stays in disambiguation phase with errorBlock", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_mm_race",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            multiMatchQuery: "Gone",
            candidates: [
              { id: "wi_gone", label: "Gone Task" },
              { id: "wi_still_here", label: "Still Here" },
            ],
          }),
        }),
      ],
      entitiesById: {
        // No entry for "wi_gone" -> mock returns null.
      },
    });
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "wi_gone",
      callbackId: "runway_edit_task",
      proposalId: "prop_mm_race",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    // Proposal NOT mutated when the row is gone.
    expect(handles.proposalUpdates).toHaveLength(0);

    // views.update was called to surface the error, BUT the rebuild kept the
    // disambiguation phase (currentValues unset, candidates carried through,
    // errorBlock present).
    expect(handles.viewsUpdate).toHaveBeenCalledTimes(1);
    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const call = handles.buildTaskModal.mock.calls[0][0] as {
      currentValues?: unknown;
      multiMatchCandidates?: Array<{ id: string }>;
      errorBlock?: { blockId: string; message: string };
    };
    expect(call.currentValues).toBeUndefined();
    expect(Array.isArray(call.multiMatchCandidates)).toBe(true);
    expect(call.multiMatchCandidates?.length).toBeGreaterThan(0);
    expect(call.errorBlock).toBeDefined();
    expect(call.errorBlock?.message).toMatch(/gone/i);
    // Civ voice: ASCII hyphens only, no em-dashes.
    expect(call.errorBlock?.message).not.toMatch(/\u2014/);
  });

  it("Terminal-state proposal (submitted): no-op return 200, no mutation, no views.update", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_mm_done",
          kind: "edit",
          toolName: "update_week_item",
          status: "submitted",
        }),
      ],
      entitiesById: {
        wi_anything: { id: "wi_anything", title: "Anything" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "wi_anything",
      proposalId: "prop_mm_done",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
    expect(handles.buildTaskModal).not.toHaveBeenCalled();
    expect(handles.loadEntityById).not.toHaveBeenCalled();
  });

  it.each(["cancelled", "expired", "failed"] as const)(
    "Terminal-state proposal (%s): no-op return 200",
    async (status) => {
      const handles = setupRouteMocks({
        proposals: [
          makeProposal({
            id: "prop_mm_term",
            kind: "edit",
            toolName: "update_week_item",
            status,
          }),
        ],
      });
      const { POST } = await import("./route");

      const payload = buildPickerPayload({
        selectedId: "wi_x",
        proposalId: "prop_mm_term",
      });
      const res = await POST(makeRequest(encodePayload(payload)) as never);
      expect(res.status).toBe(200);

      expect(handles.proposalUpdates).toHaveLength(0);
      expect(handles.viewsUpdate).not.toHaveBeenCalled();
      expect(handles.buildTaskModal).not.toHaveBeenCalled();
    },
  );

  it("Missing proposal: no-op return 200, no mutation, no views.update", async () => {
    const handles = setupRouteMocks({ proposals: [] });
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "wi_x",
      proposalId: "prop_does_not_exist",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
    expect(handles.buildTaskModal).not.toHaveBeenCalled();
    expect(handles.loadEntityById).not.toHaveBeenCalled();
  });

  it("swallows views.update hash_conflict errors gracefully", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_mm_hash",
          kind: "edit",
          toolName: "update_week_item",
        }),
      ],
      entitiesById: {
        wi_pick: { id: "wi_pick", title: "Pick Me" },
      },
    });
    handles.viewsUpdate.mockRejectedValueOnce(new Error("hash_conflict"));
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "wi_pick",
      proposalId: "prop_mm_hash",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    // Even though Slack rejects the update, the handler still acks 200.
    expect(res.status).toBe(200);
  });

  it("Wrong toolName (create flow): no-op return 200, no mutation, no views.update", async () => {
    // The picker should never render in create flows; if a stale block_actions
    // event still reaches the handler with a create-flow proposal, we ignore
    // it defensively rather than crashing or partially mutating state.
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_mm_create",
          kind: "create",
          toolName: "create_week_item",
        }),
      ],
      entitiesById: {
        wi_pick: { id: "wi_pick", title: "Pick Me" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "wi_pick",
      proposalId: "prop_mm_create",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
    expect(handles.buildTaskModal).not.toHaveBeenCalled();
  });

  // Bug B: row.resources lands as a CSV string from the DB. The view-builder
  // expects a string[] ("Role: Name" entries). The handler must convert.
  it("Bug B: converts row.resources CSV string into a string array for the rebuild", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_mm_resources",
          kind: "edit",
          toolName: "update_week_item",
          targetEntityId: null,
          targetEntityType: null,
          args: JSON.stringify({
            multiMatchQuery: "Concept",
            candidates: [
              { id: "wi_resources", label: "Concept Writeup" },
              { id: "wi_other", label: "Other" },
            ],
          }),
        }),
      ],
      entitiesById: {
        wi_resources: {
          id: "wi_resources",
          title: "Concept Writeup",
          clientId: "client_ag1",
          projectId: "proj_q3",
          resources: "AM: Lane Jordan, CD: Lane Carter",
        },
      },
      clientNamesById: { client_ag1: "AG1" },
      projectsByClient: { client_ag1: [{ id: "proj_q3", name: "Q3" }] },
    });
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "wi_resources",
      callbackId: "runway_edit_task",
      proposalId: "prop_mm_resources",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const call = handles.buildTaskModal.mock.calls[0][0] as {
      currentValues?: Record<string, unknown>;
    };
    expect(Array.isArray(call.currentValues?.resources)).toBe(true);
    expect(call.currentValues?.resources).toEqual([
      "AM: Lane Jordan",
      "CD: Lane Carter",
    ]);
  });

  it("Bug B: resources empty/missing on the row stays empty (no array, no crash)", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_mm_no_resources",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            multiMatchQuery: "Concept",
            candidates: [
              { id: "wi_no_res", label: "Concept Writeup" },
              { id: "wi_other_2", label: "Other" },
            ],
          }),
        }),
      ],
      entitiesById: {
        wi_no_res: {
          id: "wi_no_res",
          title: "Concept Writeup",
          clientId: "client_ag1",
          // resources omitted (or null)
        },
      },
      clientNamesById: { client_ag1: "AG1" },
    });
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "wi_no_res",
      callbackId: "runway_edit_task",
      proposalId: "prop_mm_no_resources",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    // No throw; resources is either undefined or an empty array (handler may
    // omit it; the view-builder treats both equivalently).
    const call = handles.buildTaskModal.mock.calls[0][0] as {
      currentValues?: Record<string, unknown>;
    };
    const resources = call.currentValues?.resources;
    expect(resources === undefined || (Array.isArray(resources) && resources.length === 0)).toBe(
      true,
    );
  });

  // Bug C: after pick, args is persisted with enriched fields so subsequent
  // cascade rebuilds (date_type toggle, client switch) preserve fields the
  // user did not touch. The pick must write the enriched data into proposal.args.
  it("Bug C: persists enriched row data into proposal.args so cascade rebuilds preserve untouched prefills", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_mm_persist",
          kind: "edit",
          toolName: "update_week_item",
          targetEntityId: null,
          targetEntityType: null,
          args: JSON.stringify({
            multiMatchQuery: "Concept",
            candidates: [
              { id: "wi_persist", label: "Concept Writeup" },
              { id: "wi_other_3", label: "Other" },
            ],
          }),
        }),
      ],
      entitiesById: {
        wi_persist: {
          id: "wi_persist",
          title: "Concept Writeup",
          clientId: "client_ag1",
          projectId: "proj_q3",
          owner: "Jason Burks",
          notes: "Hero card draft.",
          category: "delivery",
          resources: "AM: Lane Jordan",
          dateType: "single",
          date: "2026-05-08",
        },
      },
      clientNamesById: { client_ag1: "AG1" },
      projectsByClient: { client_ag1: [{ id: "proj_q3", name: "Q3 Refresh" }] },
    });
    const { POST } = await import("./route");

    const payload = buildPickerPayload({
      selectedId: "wi_persist",
      callbackId: "runway_edit_task",
      proposalId: "prop_mm_persist",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    // Persisted args MUST include the enriched fields, NOT just the FK
    // values, so subsequent cascades inherit prefill defaults.
    expect(handles.proposalUpdates).toHaveLength(1);
    const patch = handles.proposalUpdates[0].patch as { args?: string };
    expect(typeof patch.args).toBe("string");
    const persistedArgs = JSON.parse(patch.args ?? "{}") as Record<string, unknown>;

    // Cleared discriminator fields.
    expect(persistedArgs.candidates).toBeUndefined();
    expect(persistedArgs.multiMatchQuery).toBeUndefined();

    // Enriched + raw FK + label fields all present.
    expect(persistedArgs.title).toBe("Concept Writeup");
    expect(persistedArgs.clientId).toBe("client_ag1");
    expect(persistedArgs.clientName).toBe("AG1");
    expect(persistedArgs.projectId).toBe("proj_q3");
    expect(persistedArgs.projectName).toBe("Q3 Refresh");
    expect(persistedArgs.owner).toBe("Jason Burks");
    expect(persistedArgs.notes).toBe("Hero card draft.");
    expect(persistedArgs.category).toBe("delivery");
    expect(Array.isArray(persistedArgs.resources)).toBe(true);
    expect(persistedArgs.resources).toEqual(["AM: Lane Jordan"]);
  });

  it("Bug C: a subsequent date_type toggle after pick preserves owner/notes/resources from persisted args", async () => {
    // Seed the proposal with the SHAPE that handleMultiMatchCandidateSelect
    // would have written: enriched args including labels and resources array,
    // candidates/multiMatchQuery cleared. This simulates the user toggling
    // date_type after a successful pick. state.values only carries the
    // dateType radio (the user only touched that block).
    const enrichedArgs = {
      title: "Concept Writeup",
      clientId: "client_ag1",
      clientName: "AG1",
      projectId: "proj_q3",
      projectName: "Q3 Refresh",
      owner: "Jason Burks",
      notes: "Hero card draft.",
      category: "delivery",
      resources: ["AM: Lane Jordan"],
      dateType: "single",
      date: "2026-05-08",
    };
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_dt_after_pick",
          kind: "edit",
          toolName: "update_week_item",
          targetEntityId: "wi_persist",
          targetEntityType: "week_item",
          args: JSON.stringify(enrichedArgs),
        }),
      ],
    });
    const { POST } = await import("./route");

    // Build a date_type_radio block_actions payload. state.values only
    // carries the radio - mirroring Slack's behavior of only including
    // user-touched blocks.
    const dateTogglePayload = {
      type: "block_actions",
      team: { id: "T_TEST_TEAM" },
      user: { id: "U_TEST_001", team_id: "T_TEST_TEAM" },
      trigger_id: "trigger_dt_after_pick",
      response_url: null,
      channel: { id: "C_TEST_001" },
      view: {
        id: "V_TEST_DT_AFTER",
        hash: "hash_dt_after_v1",
        callback_id: "runway_edit_task",
        private_metadata: JSON.stringify({ proposalId: "prop_dt_after_pick" }),
        state: {
          values: {
            date_type_block: {
              date_type_radio: { selected_option: { value: "range" } },
            },
          },
        },
      },
      actions: [
        {
          action_id: "date_type_radio",
          block_id: "date_type_block",
          type: "radio_buttons",
          selected_option: { value: "range" },
        },
      ],
    };

    const res = await POST(makeRequest(encodePayload(dateTogglePayload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const call = handles.buildTaskModal.mock.calls[0][0] as {
      currentValues?: Record<string, unknown>;
    };
    // Untouched-but-prefilled fields must still be present (loaded from args).
    expect(call.currentValues?.owner).toBe("Jason Burks");
    expect(call.currentValues?.notes).toBe("Hero card draft.");
    expect(call.currentValues?.title).toBe("Concept Writeup");
    expect(call.currentValues?.clientId).toBe("client_ag1");
    expect(call.currentValues?.clientName).toBe("AG1");
    expect(call.currentValues?.projectId).toBe("proj_q3");
    expect(call.currentValues?.projectName).toBe("Q3 Refresh");
    expect(call.currentValues?.resources).toEqual(["AM: Lane Jordan"]);
    // dateType reflects the toggle.
    expect(call.currentValues?.dateType).toBe("range");
  });

  it("Single -> Range toggle drops stale date initials so new pickers render empty", async () => {
    // Repro: Slack's datepicker reports `initial_date` as `selected_date` on
    // view_submission even when the user never opened the picker. Carrying
    // the prior Single mode's mirrored dates (date == startDate == endDate)
    // forward into the new Range pickers caused the user's startDate change
    // to combine with the carried-forward endDate (= prior date) and trip
    // the start <= end write-time guard. The toggle handler must clear the
    // date trio when dateType changes so the new mode's pickers render
    // empty and the user must explicitly pick.
    const enrichedArgs = {
      title: "TEST Task Single A",
      clientId: "client_abm",
      projectId: "proj_retainer",
      owner: "Jason Burks",
      category: "delivery",
      resources: ["AM: Lane Jordan"],
      // Single-mode mirroring (the row enrichment shape).
      date: "2026-05-12",
      startDate: "2026-05-12",
      endDate: "2026-05-12",
    };
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_dt_drop_stale",
          kind: "edit",
          toolName: "update_week_item",
          targetEntityId: "wi_test_single_a",
          targetEntityType: "week_item",
          args: JSON.stringify(enrichedArgs),
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = {
      type: "block_actions",
      team: { id: "T_TEST_TEAM" },
      user: { id: "U_TEST_001", team_id: "T_TEST_TEAM" },
      trigger_id: "trigger_dt_drop",
      response_url: null,
      channel: { id: "C_TEST_001" },
      view: {
        id: "V_DT_DROP",
        hash: "hash_dt_drop_v1",
        callback_id: "runway_edit_task",
        private_metadata: JSON.stringify({ proposalId: "prop_dt_drop_stale" }),
        state: {
          values: {
            date_type_block: {
              date_type_radio: { selected_option: { value: "range" } },
            },
          },
        },
      },
      actions: [
        {
          action_id: "date_type_radio",
          block_id: "date_type_block",
          type: "radio_buttons",
          selected_option: { value: "range" },
        },
      ],
    };
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const call = handles.buildTaskModal.mock.calls[0][0] as {
      currentValues?: Record<string, unknown>;
    };
    // Critical: the inherited Single-mode dates MUST NOT carry into the
    // Range pickers. They render empty so the user must commit explicitly.
    expect(call.currentValues?.date).toBeUndefined();
    expect(call.currentValues?.startDate).toBeUndefined();
    expect(call.currentValues?.endDate).toBeUndefined();
    // Non-date prefills are still preserved.
    expect(call.currentValues?.title).toBe("TEST Task Single A");
    expect(call.currentValues?.owner).toBe("Jason Burks");
    expect(call.currentValues?.dateType).toBe("range");
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

    expect(handles.postEphemeral).toHaveBeenCalledTimes(1);
    const ephemeralArgs = handles.postEphemeral.mock.calls[0][0] as {
      channel: string;
      user: string;
      text: string;
    };
    expect(ephemeralArgs.channel).toBe("C_TEST_001");
    expect(ephemeralArgs.user).toBe("U_TEST_001");
    expect(ephemeralArgs.text).toMatch(/Saving your changes/i);
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

// ----------------------------------------------------------------------------
// HOLDOUT QA — multi-match candidate picker edge cases
//
// Independently-written failing tests probing concurrency, failure injection,
// boundary values, state transitions, and missing-data scenarios for the Wave
// 2 multi_match_candidate_select handler. The dev tests above cover the happy
// paths and a handful of misuse cases; this block hunts for what those tests
// did not cover.
//
// These tests intentionally do NOT modify any production code. If a test
// fails, the operator decides whether the production code or the test is
// wrong before any fixes ship.
// ----------------------------------------------------------------------------

describe("holdout: multi-match candidate picker edge cases", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  function buildHoldoutPickerPayload(opts: {
    selectedId?: string;
    callbackId?: string;
    proposalId?: string;
    viewId?: string;
    viewHash?: string;
    privateMetadata?: string | null;
    /** Override user.id on the payload. Defaults to the makeProposal default
     *  userSlackId so the ownership guard passes. Set to a different value
     *  to assert the cross-user defense-in-depth path. */
    userSlackId?: string;
  }) {
    const proposalId = opts.proposalId ?? "prop_holdout_001";
    const meta =
      opts.privateMetadata !== undefined
        ? opts.privateMetadata
        : JSON.stringify({ proposalId });
    const view: Record<string, unknown> = {
      id: opts.viewId ?? "V_HOLDOUT_001",
      hash: opts.viewHash ?? "hash_holdout_v1",
      callback_id: opts.callbackId ?? "runway_edit_task",
      state: { values: {} },
    };
    if (meta !== null) view.private_metadata = meta;
    const action: Record<string, unknown> = {
      action_id: "multi_match_candidate_select",
      block_id: "multi_match_candidate_block",
      type: "static_select",
    };
    if (opts.selectedId !== undefined) {
      action.selected_option = { value: opts.selectedId };
    }
    return {
      type: "block_actions",
      team: { id: "T_HOLDOUT" },
      user: { id: opts.userSlackId ?? "U_TEST_001", team_id: "T_HOLDOUT" },
      trigger_id: "trigger_holdout",
      response_url: null,
      channel: { id: "C_HOLDOUT" },
      view,
      actions: [action],
    };
  }

  // ---------------------------------------------------------------
  // Double-trigger / concurrency
  // ---------------------------------------------------------------

  it("rapid double-pick on different values: last write wins, both ack 200", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_concurrent_diff",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            multiMatchQuery: "Concept",
            candidates: [
              { id: "wi_a", label: "Concept A" },
              { id: "wi_b", label: "Concept B" },
            ],
          }),
        }),
      ],
      entitiesById: {
        wi_a: { id: "wi_a", title: "Concept A" },
        wi_b: { id: "wi_b", title: "Concept B" },
      },
    });
    const { POST } = await import("./route");

    const payloadA = buildHoldoutPickerPayload({
      selectedId: "wi_a",
      proposalId: "prop_h_concurrent_diff",
    });
    const payloadB = buildHoldoutPickerPayload({
      selectedId: "wi_b",
      proposalId: "prop_h_concurrent_diff",
    });

    const [resA, resB] = await Promise.all([
      POST(makeRequest(encodePayload(payloadA)) as never),
      POST(makeRequest(encodePayload(payloadB)) as never),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    // Both writes happened.
    expect(handles.proposalUpdates.length).toBeGreaterThanOrEqual(2);
    // Last patch on the row is one of the two pick ids; current state reflects one of them.
    const finalRow = handles.proposals.get("prop_h_concurrent_diff");
    expect(["wi_a", "wi_b"]).toContain(finalRow?.targetEntityId);
  });

  it("rapid double-pick on same value: idempotent, both ack 200", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_concurrent_same",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            candidates: [{ id: "wi_dup", label: "Dup" }],
          }),
        }),
      ],
      entitiesById: {
        wi_dup: { id: "wi_dup", title: "Dup" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_dup",
      proposalId: "prop_h_concurrent_same",
    });

    const [r1, r2] = await Promise.all([
      POST(makeRequest(encodePayload(payload)) as never),
      POST(makeRequest(encodePayload(payload)) as never),
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Final state is consistent regardless of how many writes fired.
    const finalRow = handles.proposals.get("prop_h_concurrent_same");
    expect(finalRow?.targetEntityId).toBe("wi_dup");
    expect(finalRow?.targetEntityType).toBe("week_item");
  });

  // ---------------------------------------------------------------
  // Failure injection
  // ---------------------------------------------------------------

  it("views.update throws non-hash_conflict (e.g., ECONNRESET): handler still acks 200", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_econn",
          kind: "edit",
          toolName: "update_week_item",
        }),
      ],
      entitiesById: {
        wi_econn: { id: "wi_econn", title: "ECONN" },
      },
    });
    handles.viewsUpdate.mockRejectedValueOnce(new Error("ECONNRESET"));
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_econn",
      proposalId: "prop_h_econn",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
  });

  it("loadEntityById throws (not just returns null): handler acks 200, no proposal mutation", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_load_throw",
          kind: "edit",
          toolName: "update_week_item",
        }),
      ],
    });
    handles.loadEntityById.mockRejectedValueOnce(new Error("upstream db oom"));
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_anything",
      proposalId: "prop_h_load_throw",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    // Proposal must not be partially mutated when the row load failed.
    expect(handles.proposalUpdates).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Boundary values
  // ---------------------------------------------------------------

  it("selected_option.value is empty string: no-op, ack 200", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_empty_val",
          kind: "edit",
          toolName: "update_week_item",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "",
      proposalId: "prop_h_empty_val",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
  });

  it("picked id is wrong-kind (project id but proposal is task): treated as row-not-found", async () => {
    // proposal.toolName=update_week_item -> loadEntityById called with kind="task".
    // The mock only has the id under entitiesById but the production loader
    // would scope by table; since our mock returns null when an id isn't found
    // for the (kind, id) lookup, this simulates loading a project id from the
    // weekItems table -> null. Handler should re-render disambiguation.
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_wrong_kind",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            candidates: [
              { id: "proj_wrong_kind", label: "Some Project" },
              { id: "wi_right", label: "Right Task" },
            ],
          }),
        }),
      ],
      // Set up the mock so that the loader returns null for this id under "task" kind.
      entitiesById: {
        // Intentionally no entry: simulates the kind-scoped query returning empty.
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "proj_wrong_kind",
      proposalId: "prop_h_wrong_kind",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    // Proposal NOT mutated.
    expect(handles.proposalUpdates).toHaveLength(0);
    // Disambiguation re-render with errorBlock.
    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const call = handles.buildTaskModal.mock.calls[0][0] as {
      errorBlock?: { message: string };
      multiMatchCandidates?: unknown[];
    };
    expect(call.errorBlock).toBeDefined();
  });

  it("private_metadata is empty string: no-op, ack 200", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_meta_empty",
          kind: "edit",
          toolName: "update_week_item",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_anything",
      proposalId: "prop_h_meta_empty",
      privateMetadata: "",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
  });

  it("private_metadata is malformed JSON: no-op, ack 200", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_meta_bad",
          kind: "edit",
          toolName: "update_week_item",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_anything",
      proposalId: "prop_h_meta_bad",
      privateMetadata: "{not valid json",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
  });

  it("private_metadata is JSON null: no-op, ack 200", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_meta_null",
          kind: "edit",
          toolName: "update_week_item",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_anything",
      proposalId: "prop_h_meta_null",
      privateMetadata: "null",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
    expect(handles.proposalUpdates).toHaveLength(0);
  });

  it("private_metadata is JSON without proposalId field: no-op, ack 200", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_meta_no_id",
          kind: "edit",
          toolName: "update_week_item",
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_anything",
      proposalId: "prop_h_meta_no_id",
      privateMetadata: JSON.stringify({ clientId: "client_x" }),
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
    expect(handles.proposalUpdates).toHaveLength(0);
  });

  it("100+ candidates: handler resolves an id past position 100 cleanly", async () => {
    // Wave 1 truncates to 100 in the picker UI, but the handler should still
    // resolve any id the user managed to send (via stale Slack state).
    const candidates = Array.from({ length: 120 }).map((_, i) => ({
      id: `wi_${i.toString().padStart(3, "0")}`,
      label: `Candidate ${i}`,
    }));
    const pickedId = "wi_117"; // position 117, beyond the 100 cap
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_big_list",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({ candidates }),
        }),
      ],
      entitiesById: {
        [pickedId]: { id: pickedId, title: "Way past 100" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: pickedId,
      proposalId: "prop_h_big_list",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.proposalUpdates).toHaveLength(1);
    expect(handles.proposalUpdates[0].patch.targetEntityId).toBe(pickedId);
  });

  it("proposal.toolName empty string: no-op, ack 200, no DB writes", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_tool_empty",
          kind: "edit",
          toolName: "",
        }),
      ],
      entitiesById: {
        wi_anything: { id: "wi_anything", title: "Anything" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_anything",
      proposalId: "prop_h_tool_empty",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
  });

  it("proposal.toolName unrecognized: no-op, ack 200, no DB writes", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_tool_weird",
          kind: "edit",
          toolName: "frobnicate_widget",
        }),
      ],
      entitiesById: {
        wi_anything: { id: "wi_anything", title: "Anything" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_anything",
      proposalId: "prop_h_tool_weird",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // State transition
  // ---------------------------------------------------------------

  it("post-pick re-fire on already-edit proposal (candidates cleared): defensive 200", async () => {
    // Simulate: user picked once, proposal mutated to (targetEntityId set,
    // args.candidates removed), then the same picker fires again from a stale
    // Slack client. Handler should not crash; treat as best-effort no-op or
    // re-write the same target.
    setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_post_pick",
          kind: "edit",
          toolName: "update_week_item",
          targetEntityId: "wi_first",
          targetEntityType: "week_item",
          args: JSON.stringify({}), // candidates already stripped
        }),
      ],
      entitiesById: {
        wi_second: { id: "wi_second", title: "Second" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_second",
      proposalId: "prop_h_post_pick",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
  });

  // ---------------------------------------------------------------
  // Missing data
  // ---------------------------------------------------------------

  it("picked entity row exists but with NULL/empty fields: view rebuild does not crash", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_null_fields",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            candidates: [{ id: "wi_null", label: "Null Title Row" }],
          }),
        }),
      ],
      entitiesById: {
        wi_null: {
          id: "wi_null",
          title: null,
          clientId: null,
          projectId: null,
          category: null,
        },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_null",
      proposalId: "prop_h_null_fields",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.proposalUpdates).toHaveLength(1);
    expect(handles.buildTaskModal).toHaveBeenCalledTimes(1);
    const call = handles.buildTaskModal.mock.calls[0][0] as {
      currentValues?: Record<string, unknown>;
    };
    expect(call.currentValues).toBeDefined();
    // The currentValues spread retains the null fields rather than crashing.
    expect(call.currentValues?.title).toBeNull();
  });

  it("proposal.args is corrupt JSON: idempotency guard treats as stale, no DB write, no row load", async () => {
    // Wave 6 / Fix 6.1: corrupt args parse to {}, so args.candidates is
    // missing - the handler treats this as a stale double-pick (the first
    // pick already cleared candidates) and skips the DB write + row load.
    // It still attempts views.update so Slack acks cleanly.
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_args_corrupt",
          kind: "edit",
          toolName: "update_week_item",
          args: "{not valid json",
        }),
      ],
      entitiesById: {
        wi_pick: { id: "wi_pick", title: "Pick Me" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_pick",
      proposalId: "prop_h_args_corrupt",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
  });

  it("proposal.args has no candidates field: idempotency guard fires (stale double-pick)", async () => {
    // Wave 6 / Fix 6.1: missing candidates means the first pick already
    // cleared them. Treat the second event as a no-op DB-wise.
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_no_cands",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({ multiMatchQuery: "lonely" }),
        }),
      ],
      entitiesById: {
        wi_pick: { id: "wi_pick", title: "Pick Me" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_pick",
      proposalId: "prop_h_no_cands",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
  });

  it("row-gone race + corrupt args: idempotency guard fires before row load", async () => {
    // Wave 6 / Fix 6.1: corrupt-args + missing candidates collapses into the
    // stale double-pick path before the row-gone race can be hit. Proposal
    // is intentionally NOT mutated, no row load is attempted, views.update
    // still fires so Slack acks the click.
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_corrupt_race",
          kind: "edit",
          toolName: "update_week_item",
          args: "definitely not json {{{",
        }),
      ],
      entitiesById: {},
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_gone",
      proposalId: "prop_h_corrupt_race",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
  });

  it("project flow: row with NULL name field still re-renders without crash", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_proj_null",
          kind: "edit",
          toolName: "update_project",
          args: JSON.stringify({
            candidates: [{ id: "proj_null", label: "Null Name Project" }],
          }),
        }),
      ],
      entitiesById: {
        proj_null: { id: "proj_null", name: null, clientId: null },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "proj_null",
      proposalId: "prop_h_proj_null",
      callbackId: "runway_edit_project",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.buildProjectModal).toHaveBeenCalledTimes(1);
  });

  it("team-member flow: row with NULL fullName field still re-renders without crash", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_tm_null",
          kind: "edit",
          toolName: "update_team_member",
          args: JSON.stringify({
            candidates: [{ id: "tm_null", label: "Null Name TM" }],
          }),
        }),
      ],
      entitiesById: {
        tm_null: { id: "tm_null", fullName: null },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "tm_null",
      proposalId: "prop_h_tm_null",
      callbackId: "runway_edit_team_member",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.buildTeamMemberModal).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------
  // Ownership guard (defense-in-depth)
  // ---------------------------------------------------------------

  it("payload.user.id !== proposal.userSlackId: ack 200, no mutation, no views.update, no row load", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_owner_mismatch",
          kind: "edit",
          toolName: "update_week_item",
          userSlackId: "U_OWNER",
          args: JSON.stringify({
            candidates: [{ id: "wi_target", label: "Target" }],
          }),
        }),
      ],
      entitiesById: {
        wi_target: { id: "wi_target", title: "Target" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_target",
      proposalId: "prop_h_owner_mismatch",
      userSlackId: "U_INTRUDER",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    // Proposal must not be mutated by a non-owner click.
    expect(handles.proposalUpdates).toHaveLength(0);
    // No views.update fired.
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
    // Row load short-circuited before the lookup.
    expect(handles.loadEntityById).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------
  // Wave 6 fixes
  // ---------------------------------------------------------------

  it("Fix 6.1: candidates already cleared (stale double-pick): no DB write, no row load, ack 200", async () => {
    // The first pick clears args.candidates. A second block_actions firing
    // with the same proposal observes empty candidates and bails before the
    // DB write and the row load.
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_idempotent",
          kind: "edit",
          toolName: "update_week_item",
          targetEntityId: "wi_already_picked",
          targetEntityType: "week_item",
          args: JSON.stringify({ multiMatchQuery: "x" }), // candidates already cleared
        }),
      ],
      entitiesById: {
        wi_double_click: { id: "wi_double_click", title: "Double Click" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_double_click",
      proposalId: "prop_h_idempotent",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
  });

  it("Fix 6.3: team-member with only legacy `name` set, fullName falls back to name on rebuild", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_tm_fb",
          kind: "edit",
          toolName: "update_team_member",
          args: JSON.stringify({
            candidates: [{ id: "tm_riley", label: "Riley" }],
          }),
        }),
      ],
      entitiesById: {
        tm_riley: {
          id: "tm_riley",
          fullName: null,
          name: "Riley",
          roleCategory: "creative",
        },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "tm_riley",
      proposalId: "prop_h_tm_fb",
      callbackId: "runway_edit_team_member",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);

    expect(handles.buildTeamMemberModal).toHaveBeenCalledTimes(1);
    const call = handles.buildTeamMemberModal.mock.calls[0][0] as {
      currentValues?: Record<string, unknown>;
    };
    expect(call.currentValues?.fullName).toBe("Riley");
  });

  it("Fix 6.7: row-gone path uses ROW_GONE_MESSAGE; load-failed path uses LOAD_FAILED_MESSAGE", async () => {
    // Row-gone case
    const handlesGone = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_msg_gone",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            candidates: [{ id: "wi_gone", label: "Gone" }],
          }),
        }),
      ],
      entitiesById: {},
    });
    const route1 = await import("./route");

    const goneRes = await route1.POST(
      makeRequest(
        encodePayload(
          buildHoldoutPickerPayload({
            selectedId: "wi_gone",
            proposalId: "prop_h_msg_gone",
          }),
        ),
      ) as never,
    );
    expect(goneRes.status).toBe(200);
    const goneCall = handlesGone.buildTaskModal.mock.calls[0][0] as {
      errorBlock?: { blockId: string; message: string };
    };
    expect(goneCall.errorBlock?.blockId).toBe("row_gone_block");
    expect(goneCall.errorBlock?.message).toMatch(/gone/i);

    // Load-failed case (loadEntityById throws)
    const handlesFail = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_msg_fail",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            candidates: [{ id: "wi_fail", label: "Fail" }],
          }),
        }),
      ],
    });
    handlesFail.loadEntityById.mockRejectedValueOnce(new Error("upstream oom"));
    const route2 = await import("./route");

    const failRes = await route2.POST(
      makeRequest(
        encodePayload(
          buildHoldoutPickerPayload({
            selectedId: "wi_fail",
            proposalId: "prop_h_msg_fail",
          }),
        ),
      ) as never,
    );
    expect(failRes.status).toBe(200);
    const failCall = handlesFail.buildTaskModal.mock.calls[0][0] as {
      errorBlock?: { blockId: string; message: string };
    };
    expect(failCall.errorBlock?.blockId).toBe("load_failed_block");
    // Distinct copy from the row-gone message; no overlap on "gone".
    expect(failCall.errorBlock?.message).not.toBe(goneCall.errorBlock?.message);
    expect(failCall.errorBlock?.message).toMatch(/load/i);
  });

  it("Fix 6.9: missing view.hash logs a warn but still calls views.update", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_no_hash",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            candidates: [{ id: "wi_x", label: "X" }],
          }),
        }),
      ],
      entitiesById: {
        wi_x: { id: "wi_x", title: "X" },
      },
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "wi_x",
      proposalId: "prop_h_no_hash",
    });
    // Strip hash off the view.
    (payload.view as Record<string, unknown>).hash = undefined;

    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.viewsUpdate).toHaveBeenCalledTimes(1);
    const call = handles.viewsUpdate.mock.calls[0][0] as { hash?: string };
    expect(call.hash).toBeUndefined();
    // Warn fired with race-detection message.
    const warned = warnSpy.mock.calls.some((c) =>
      typeof c[0] === "string" &&
      c[0].includes("views.update without hash"),
    );
    expect(warned).toBe(true);
    warnSpy.mockRestore();
  });

  it("Fix 6.10: oversized selected_option.value (>100 chars): no-op, ack 200, warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_oversize",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            candidates: [{ id: "wi_y", label: "Y" }],
          }),
        }),
      ],
    });
    const { POST } = await import("./route");

    const oversized = "x".repeat(150);
    const payload = buildHoldoutPickerPayload({
      selectedId: oversized,
      proposalId: "prop_h_oversize",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
    expect(handles.proposalUpdates).toHaveLength(0);
    expect(handles.viewsUpdate).not.toHaveBeenCalled();
    const warned = warnSpy.mock.calls.some((c) =>
      typeof c[0] === "string" &&
      c[0].includes("oversized selected_option.value"),
    );
    expect(warned).toBe(true);
    warnSpy.mockRestore();
  });

  it("Fix 6.10: whitespace-only selected_option.value: no-op, ack 200", async () => {
    const handles = setupRouteMocks({
      proposals: [
        makeProposal({
          id: "prop_h_ws",
          kind: "edit",
          toolName: "update_week_item",
          args: JSON.stringify({
            candidates: [{ id: "wi_z", label: "Z" }],
          }),
        }),
      ],
    });
    const { POST } = await import("./route");

    const payload = buildHoldoutPickerPayload({
      selectedId: "   ",
      proposalId: "prop_h_ws",
    });
    const res = await POST(makeRequest(encodePayload(payload)) as never);
    expect(res.status).toBe(200);
    expect(handles.loadEntityById).not.toHaveBeenCalled();
    expect(handles.proposalUpdates).toHaveLength(0);
  });
});
