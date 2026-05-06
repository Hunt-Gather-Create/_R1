/**
 * Tests for `/api/slack/commands` POST route — Wave 3 / Builder 3.
 *
 * Coverage:
 *   - HMAC verification: missing secret, invalid signature, missing/null
 *     signature, stale timestamp.
 *   - Each of the 6 commands routes to the correct flow (3 create + 3 edit).
 *   - Create flow: empty text -> empty proposal + view_open with no
 *     `multiMatchHint`; text with parent name -> fuzzyMatchCandidates against
 *     mocked projects; multi-match (>1) populates `multiMatchHint`.
 *   - Edit flow lookup: ID match (ulid-shape), single fuzzy match, multi-match,
 *     no-match (ephemeral, no proposal).
 *   - Multi-match hint computation matrix: 0 / 1 / N candidates / absent name.
 *   - 3s budget assertion.
 *
 * Strategy: Mock `@/lib/slack/client` and `@/lib/db/runway`. The mocked
 * `getRunwayDb()` returns a chainable object that:
 *   - Captures `insert(...).values(row)` payloads into `insertedProposals`.
 *   - For `select().from(table)`, dispatches to fixture rows by table identity
 *     (projects | weekItems | teamMembers).
 *   - For `where(eq(table.id, id))`, narrows to the fixture row matching the id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableName } from "drizzle-orm";
import { makeSlackSignature, nowTimestamp, loadFixture } from "@/lib/slack/test-helpers";
import { makeSlashRequest, encodeFormBody } from "./route-test-helpers";
// NOTE: we deliberately do NOT import the schema tables at the top level
// here. `vi.resetModules()` re-imports `@/lib/db/runway-schema` for the
// route, producing FRESH table object identities. If we held a reference
// from the test file's top-level import, identity comparisons against
// `state.lastTable` would never match. Instead we dispatch SELECTs and
// INSERTs by `getTableName` (string, stable across re-imports).

// ────────────────────────────────────────────────────────────────────────────
// Fixture project / week_item / team_member rows. Tiny + reproducible:
// "Brand Refresh" + "Brand Strategy" both fuzzy-match "Brand"; "Landing Page
// Copy" matches uniquely; "AG1 Pro Subscriber 2026" matches "AG1 Pro".
// ────────────────────────────────────────────────────────────────────────────
const FIXTURE_PROJECTS = [
  { id: "proj_brand_refresh_xyz123", name: "Brand Refresh", clientId: "cli_ag1", engagementType: "project" },
  { id: "proj_brand_strategy_xyz12", name: "Brand Strategy", clientId: "cli_ag1", engagementType: "project" },
  { id: "proj_ag1_pro_2026_full_id1", name: "AG1 Pro Subscriber 2026", clientId: "cli_ag1", engagementType: "project" },
  { id: "proj_landing_page_full_id1", name: "Landing Page Copy", clientId: "cli_ag1", engagementType: "project" },
  { id: "proj_retainer_wrap_fullid01", name: "Retainer Wrapper", clientId: "cli_ag1", engagementType: "retainer" },
];

const FIXTURE_WEEK_ITEMS = [
  // Distinct enough that "Concept Writeup" hits #1 alone at the slash-fuzzy
  // threshold (0.4). The second item shares no full-word prefix so its score
  // stays below threshold.
  { id: "wi_concept_writeup_full_id", title: "Concept Writeup", clientId: "cli_ag1", projectId: "proj_brand_refresh_xyz123" },
  { id: "wi_kickoff_full_id_xyzabcd", title: "Kickoff Call",    clientId: "cli_ag1", projectId: "proj_brand_refresh_xyz123" },
];

const FIXTURE_TEAM_MEMBERS = [
  { id: "tm_lane_full_ulid_xx_id_1", name: "Lane",   fullName: "Lane Lopez",   roleCategory: "creative" },
  { id: "tm_leslie_full_ulid_xx_id", name: "Leslie", fullName: "Leslie Park",  roleCategory: "dev" },
];

// Build a chainable `select().from(table).where(...).limit(...)` mock that
// dispatches by table identity.
type MockState = {
  insertedProposals: unknown[];
  // Track the selected table so chained where() / limit() know what to filter.
  lastTable: unknown;
  whereFilter: ((row: Record<string, unknown>) => boolean) | null;
};

function makeDbMock(): { db: unknown; state: MockState } {
  const state: MockState = {
    insertedProposals: [],
    lastTable: null,
    whereFilter: null,
  };
  const tableRows = (t: unknown): Record<string, unknown>[] => {
    const name = (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return getTableName(t as any);
      } catch {
        return "";
      }
    })();
    if (name === "projects") return FIXTURE_PROJECTS as unknown as Record<string, unknown>[];
    if (name === "week_items") return FIXTURE_WEEK_ITEMS as unknown as Record<string, unknown>[];
    if (name === "team_members") return FIXTURE_TEAM_MEMBERS as unknown as Record<string, unknown>[];
    return [];
  };
  const buildSelectChain = () => {
    const exec = () => {
      const rows = tableRows(state.lastTable);
      if (!state.whereFilter) return rows;
      return rows.filter(state.whereFilter);
    };
    const chain: {
      from: (t: unknown) => typeof chain;
      where: (filter: { _idMatch?: string; _filter?: (r: Record<string, unknown>) => boolean }) => typeof chain;
      limit: () => Promise<Record<string, unknown>[]>;
      then: (resolve: (rows: Record<string, unknown>[]) => unknown) => Promise<unknown>;
    } = {
      from(t: unknown) {
        state.lastTable = t;
        state.whereFilter = null;
        return chain;
      },
      where(filter) {
        if (filter._idMatch !== undefined) {
          const idMatch = filter._idMatch;
          state.whereFilter = (r) => r.id === idMatch;
        } else if (filter._filter) {
          state.whereFilter = filter._filter;
        }
        return chain;
      },
      limit() {
        return Promise.resolve(exec());
      },
      // Make `await db.select()...where(...)` work without `.limit`.
      then(resolve: (rows: Record<string, unknown>[]) => unknown) {
        return Promise.resolve(exec()).then(resolve);
      },
    };
    return chain;
  };

  const db = {
    select: () => buildSelectChain(),
    insert: (table: unknown) => ({
      values: (row: unknown) => {
        const name = (() => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return getTableName(table as any);
          } catch {
            return "";
          }
        })();
        if (name === "bot_modal_proposals") {
          state.insertedProposals.push(row);
        }
        return Promise.resolve();
      },
    }),
  };
  return { db, state };
}

/**
 * Mock the real modal view builders so tests can assert on the params that
 * the route handler passes through (proposalId, baselineHint, multiMatchHint,
 * mode, currentValues). The mocks return a minimal Block Kit-shaped object
 * plus a `__debug` field that mirrors the input — same shape the prior stub
 * builders carried, so the existing test assertions still work end-to-end.
 */
type ModalCallParams = {
  args: Record<string, unknown>;
  proposalId: string;
  mode: "create" | "edit";
  baselineHint?: string;
  multiMatchHint?: string;
  currentValues?: Record<string, unknown>;
  retainerMode?: boolean;
};

function buildMockedView(kind: "task" | "project" | "team_member", p: ModalCallParams) {
  return {
    type: "modal",
    callback_id: `runway_${p.mode}_${kind}`,
    private_metadata: JSON.stringify({ proposalId: p.proposalId }),
    title: { type: "plain_text", text: "mock" },
    blocks: [],
    __debug: {
      kind: kind === "team_member" ? "team-member" : kind,
      mode: p.mode,
      proposalId: p.proposalId,
      baselineHint: p.baselineHint,
      multiMatchHint: p.multiMatchHint,
      argsKeys: Object.keys(p.args ?? {}),
      currentValuesKeys: p.currentValues ? Object.keys(p.currentValues) : undefined,
      retainerMode: p.retainerMode,
    },
  };
}

function setupMocks() {
  const { db, state } = makeDbMock();
  const viewsOpen = vi.fn().mockResolvedValue({ ok: true });

  vi.resetModules();
  vi.doMock("@/lib/db/runway", () => ({
    getRunwayDb: () => db,
  }));
  vi.doMock("@/lib/slack/client", () => ({
    getSlackClient: () => ({
      views: { open: viewsOpen },
    }),
  }));
  // Mock the real modal view builders — tests assert on `__debug` carried
  // through the mocked output. The real builder code is exercised in its own
  // test files; here we only assert that the route plumbed the right params.
  vi.doMock("@/lib/slack/modals/task", () => ({
    buildTaskModal: vi.fn((p: ModalCallParams) => buildMockedView("task", p)),
  }));
  vi.doMock("@/lib/slack/modals/project", () => ({
    buildProjectModal: vi.fn((p: ModalCallParams) => buildMockedView("project", p)),
  }));
  vi.doMock("@/lib/slack/modals/team-member", () => ({
    buildTeamMemberModal: vi.fn((p: ModalCallParams) => buildMockedView("team_member", p)),
  }));
  // Force `eq(table.<col>, value)` to return a sentinel the mock select can
  // recognize. We don't actually care about column-level filtering here; the
  // helper parses the second arg out as the value to match `id`.
  vi.doMock("drizzle-orm", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
    return {
      ...actual,
      eq: (col: unknown, value: unknown) => ({ _idMatch: value, _col: col }),
    };
  });
  return { state, viewsOpen };
}

const SIGNING_SECRET = "test_secret";

describe("POST /api/slack/commands — HMAC + dispatch surface", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("returns 500 when SLACK_SIGNING_SECRET is missing", async () => {
    setupMocks();
    delete process.env.SLACK_SIGNING_SECRET;
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const req = makeSlashRequest(fx);
    const res = await POST(req as never);
    expect(res.status).toBe(500);
  });

  it("returns 403 for invalid signature", async () => {
    setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const req = makeSlashRequest(fx, { signature: "v0=invalid" });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
  });

  it("returns 403 when signature header is null", async () => {
    setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const req = makeSlashRequest(fx, { signature: null });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
  });

  it("returns 403 for stale timestamp (older than 5 minutes)", async () => {
    setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const stale = (Math.floor(Date.now() / 1000) - 600).toString();
    const body = encodeFormBody(fx);
    const sig = makeSlackSignature(SIGNING_SECRET, stale, body);
    const req = makeSlashRequest(fx, { timestamp: stale, signature: sig });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
  });

  it("returns 200 within the 3-second budget for a valid create command", async () => {
    setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const start = Date.now();
    const req = makeSlashRequest(fx);
    const res = await POST(req as never);
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(3000);
  });

  it("returns 400 for an unknown slash command", async () => {
    setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const payload = { ...fx, command: "/runway-not-a-real-command" };
    const req = makeSlashRequest(payload);
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/slack/commands — create command flow", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("/runway-new-task with empty text inserts proposal + opens modal with no multiMatchHint", async () => {
    const { state, viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    // fixture has command=/runway-new-task, text=""
    const req = makeSlashRequest(fx);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(state.insertedProposals).toHaveLength(1);
    const row = state.insertedProposals[0] as Record<string, unknown>;
    expect(row.kind).toBe("create");
    expect(row.toolName).toBe("create_week_item");
    expect(row.userSlackId).toBe(fx.user_id);
    expect(row.channelId).toBe(fx.channel_id);
    expect(viewsOpen).toHaveBeenCalledTimes(1);
    const callArgs = viewsOpen.mock.calls[0][0] as { trigger_id: string; view: { __debug?: { multiMatchHint?: string } } };
    expect(callArgs.trigger_id).toBe(fx.trigger_id);
    expect(callArgs.view.__debug?.multiMatchHint).toBeUndefined();
  });

  it("/runway-new-project with empty text routes to project create flow", async () => {
    const { state, viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const payload = { ...fx, command: "/runway-new-project", text: "" };
    const req = makeSlashRequest(payload);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(state.insertedProposals).toHaveLength(1);
    const row = state.insertedProposals[0] as Record<string, unknown>;
    expect(row.toolName).toBe("create_project");
    expect(row.kind).toBe("create");
    expect(viewsOpen).toHaveBeenCalledTimes(1);
  });

  it("/runway-new-team-member routes to team_member create flow (no parent picker, no hint)", async () => {
    const { state, viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const payload = { ...fx, command: "/runway-new-team-member", text: "Lee" };
    const req = makeSlashRequest(payload);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(state.insertedProposals).toHaveLength(1);
    const row = state.insertedProposals[0] as Record<string, unknown>;
    expect(row.toolName).toBe("create_team_member");
    expect(viewsOpen).toHaveBeenCalledTimes(1);
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { multiMatchHint?: string } } };
    expect(callArgs.view.__debug?.multiMatchHint).toBeUndefined();
  });

  it("/runway-new-task with text containing 'Brand' yields multiMatchHint (>=2 matches)", async () => {
    const { state, viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const payload = { ...fx, command: "/runway-new-task", text: "Concept Writeup Brand" };
    const req = makeSlashRequest(payload);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(state.insertedProposals).toHaveLength(1);
    expect(viewsOpen).toHaveBeenCalledTimes(1);
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { multiMatchHint?: string } } };
    expect(callArgs.view.__debug?.multiMatchHint).toBeDefined();
    expect(callArgs.view.__debug?.multiMatchHint).toContain("Brand");
  });

  it("/runway-new-task with single-match parent name yields no multiMatchHint", async () => {
    const { viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const payload = { ...fx, command: "/runway-new-task", text: "Concept review Landing Page Copy" };
    const req = makeSlashRequest(payload);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { multiMatchHint?: string } } };
    expect(callArgs.view.__debug?.multiMatchHint).toBeUndefined();
  });

  it("/runway-new-task with no parent name match yields no multiMatchHint", async () => {
    const { viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const payload = { ...fx, command: "/runway-new-task", text: "Concept Writeup zzz_unmatchable_qq" };
    const req = makeSlashRequest(payload);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { multiMatchHint?: string } } };
    expect(callArgs.view.__debug?.multiMatchHint).toBeUndefined();
  });
});

describe("POST /api/slack/commands — edit command flow", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("/runway-edit-project with multi-match name opens modal with target picker hint", async () => {
    const { state, viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-edit-multimatch");
    // fixture: command=/runway-edit-project, text="Brand"
    const req = makeSlashRequest(fx);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(state.insertedProposals).toHaveLength(1);
    const row = state.insertedProposals[0] as Record<string, unknown>;
    expect(row.kind).toBe("edit");
    expect(row.toolName).toBe("update_project");
    // Multi-match: targetEntityId is null, candidates rendered in modal.
    expect(row.targetEntityId).toBeNull();
    expect(viewsOpen).toHaveBeenCalledTimes(1);
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { multiMatchHint?: string } } };
    expect(callArgs.view.__debug?.multiMatchHint).toBeDefined();
    expect(callArgs.view.__debug?.multiMatchHint).toContain("Brand");
  });

  it("/runway-edit-project with ulid-shaped ID matches a single entity by id", async () => {
    const { state, viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-edit-multimatch");
    // proj_brand_refresh_xyz123 is a >=20 char id present in FIXTURE_PROJECTS.
    const payload = { ...fx, command: "/runway-edit-project", text: "proj_brand_refresh_xyz123" };
    const req = makeSlashRequest(payload);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(state.insertedProposals).toHaveLength(1);
    const row = state.insertedProposals[0] as Record<string, unknown>;
    expect(row.kind).toBe("edit");
    expect(row.targetEntityId).toBe("proj_brand_refresh_xyz123");
    expect(row.targetEntityType).toBe("project");
    expect(viewsOpen).toHaveBeenCalledTimes(1);
    // Non-retainer row -> modal opens with retainerMode=false.
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { retainerMode?: boolean } } };
    expect(callArgs.view.__debug?.retainerMode).toBe(false);
  });

  it("/runway-edit-project on a retainer row opens modal with retainerMode=true", async () => {
    // Bug X2: previously buildModalView always passed retainerMode=false,
    // so editing a retainer row reopened the modal with the wrapper checkbox
    // unchecked. Submitting any unrelated change (e.g. only Notes) silently
    // demoted engagement_type back to "project" because the unchecked
    // checkbox was read as the user's intent.
    const { viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-edit-multimatch");
    const payload = { ...fx, command: "/runway-edit-project", text: "proj_retainer_wrap_fullid01" };
    const req = makeSlashRequest(payload);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(viewsOpen).toHaveBeenCalledTimes(1);
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { retainerMode?: boolean } } };
    expect(callArgs.view.__debug?.retainerMode).toBe(true);
  });

  it("/runway-edit-task with single fuzzy-name match populates targetEntityId", async () => {
    const { state, viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-edit-multimatch");
    const payload = { ...fx, command: "/runway-edit-task", text: "Concept Writeup" };
    const req = makeSlashRequest(payload);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(state.insertedProposals).toHaveLength(1);
    const row = state.insertedProposals[0] as Record<string, unknown>;
    expect(row.kind).toBe("edit");
    expect(row.toolName).toBe("update_week_item");
    expect(row.targetEntityType).toBe("week_item");
    expect(row.targetEntityId).toBe("wi_concept_writeup_full_id");
    expect(viewsOpen).toHaveBeenCalledTimes(1);
  });

  it("/runway-edit-team-member with no match returns ephemeral (no proposal, no views.open)", async () => {
    const { state, viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-edit-multimatch");
    const payload = { ...fx, command: "/runway-edit-team-member", text: "zzz_does_not_exist_qq" };
    const req = makeSlashRequest(payload);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).toMatch(/Couldn't find/);
    expect(state.insertedProposals).toHaveLength(0);
    expect(viewsOpen).not.toHaveBeenCalled();
  });
});

// ============================================================
// Multi-match hint computation matrix (per pre-plan v7 §A3 §2).
// ============================================================
describe("POST /api/slack/commands — multiMatchHint computation matrix", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("0 candidates -> hint is undefined", async () => {
    const { viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const payload = { ...fx, command: "/runway-new-task", text: "Concept zzz_unmatchable_qq" };
    const req = makeSlashRequest(payload);
    await POST(req as never);
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { multiMatchHint?: string } } };
    expect(callArgs.view.__debug?.multiMatchHint).toBeUndefined();
  });

  it("1 candidate -> hint is undefined", async () => {
    const { viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const payload = { ...fx, command: "/runway-new-task", text: "Concept Landing Page Copy" };
    const req = makeSlashRequest(payload);
    await POST(req as never);
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { multiMatchHint?: string } } };
    expect(callArgs.view.__debug?.multiMatchHint).toBeUndefined();
  });

  it("N candidates -> hint string with N substituted", async () => {
    const { viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const payload = { ...fx, command: "/runway-new-task", text: "Concept Brand" };
    const req = makeSlashRequest(payload);
    await POST(req as never);
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { multiMatchHint?: string } } };
    expect(callArgs.view.__debug?.multiMatchHint).toBeDefined();
    expect(callArgs.view.__debug?.multiMatchHint).toMatch(/^We found \d+ /);
  });

  it("absent parent name -> hint is undefined", async () => {
    const { viewsOpen } = setupMocks();
    const { POST } = await import("./route");
    const fx = loadFixture<Record<string, string>>("slash-command-create");
    const payload = { ...fx, command: "/runway-new-task", text: "" };
    const req = makeSlashRequest(payload);
    await POST(req as never);
    const callArgs = viewsOpen.mock.calls[0][0] as { view: { __debug?: { multiMatchHint?: string } } };
    expect(callArgs.view.__debug?.multiMatchHint).toBeUndefined();
  });
});

// reference unused import to satisfy noUnusedLocals (the symbol is used as
// a table-identity sentinel in `makeDbMock` above via dynamic comparison).
void nowTimestamp;
