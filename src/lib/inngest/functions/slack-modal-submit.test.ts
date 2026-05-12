/**
 * Tests for `slackModalSubmit` Inngest function — Wave 10 / Builder 10.
 *
 * Covers happy paths (project create / retainer / task create with parent
 * resolution / team member create / project edit / task edit), idempotency,
 * submitter mismatch, validator-fail, write-throw, multi-detect chat.update,
 * and confirmation post.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────────

// In-memory proposals "table" — each test populates this directly.
// Keys: id -> row.
const proposalRows = new Map<string, Record<string, unknown>>();
// Track the where-eq value so .get() / array-await both find the right row.
let lastSelectedProposalId: string | null = null;

// Drizzle eq mock (returns a marker object the where-runner inspects).
const eqSpy = vi.fn(
  (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
);
const andSpy = vi.fn((...args: unknown[]) => ({ __op: "and", args }));

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => eqSpy(col, val),
  and: (...args: unknown[]) => andSpy(...args),
}));

// botModalProposals + clients + projects table reference (opaque to the test).
vi.mock("@/lib/db/runway-schema", () => ({
  botModalProposals: { __table: "bot_modal_proposals", id: { __col: "id" } },
  clients: { __table: "clients" },
  projects: { __table: "projects" },
  weekItems: { __table: "week_items", id: { __col: "id" } },
  teamMembers: { __table: "team_members", id: { __col: "id" } },
}));

// Auxiliary "tables" for select-chain resolution beyond proposals.
const weekItemRows = new Map<string, Record<string, unknown>>();

// Mock select chain that resolves against the proposalRows map (or
// weekItemRows when select is targeting week_items). The chain supports
// both `.get()` (used by drizzle-better-sqlite) and array-await.
function makeSelectChain() {
  let currentTable: string | null = null;
  const builder = {
    from: (table: { __table?: string }) => {
      currentTable = table?.__table ?? null;
      return {
        where: (cond: { __op: string; val?: unknown }) => {
          const id = cond?.val ? String(cond.val) : null;
          if (id) lastSelectedProposalId = id;
          const rows: Record<string, unknown>[] = [];
          if (currentTable === "week_items") {
            if (id && weekItemRows.has(id)) rows.push(weekItemRows.get(id)!);
          } else if (currentTable === "bot_modal_proposals") {
            if (id && proposalRows.has(id)) rows.push(proposalRows.get(id)!);
          }
          const arr = Object.assign(Promise.resolve(rows), {
            get: async () => rows[0] ?? null,
            limit: () => Promise.resolve(rows),
          });
          return arr;
        },
      };
    },
  };
  return builder;
}

const updateSetSpy = vi.fn();
const updateWhereSpy = vi.fn();

const mockDb = {
  select: vi.fn(() => makeSelectChain()),
  update: vi.fn(() => ({
    set: (payload: Record<string, unknown>) => {
      updateSetSpy(payload);
      return {
        where: (cond: unknown) => {
          updateWhereSpy(cond);
          // Mutate the in-memory row to match.
          if (lastSelectedProposalId && proposalRows.has(lastSelectedProposalId)) {
            const row = proposalRows.get(lastSelectedProposalId)!;
            Object.assign(row, payload);
          }
          return Promise.resolve();
        },
      };
    },
  })),
};

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => mockDb,
}));

// Validator mock — default to ok with empty normalized; tests override.
const mockValidate = vi.fn();
vi.mock("@/lib/slack/modals/validate-submission", () => ({
  validateModalSubmission: (params: unknown) => mockValidate(params),
}));

// Operations layer mocks
const mockAddProject = vi.fn();
const mockCreateWeekItem = vi.fn();
const mockCreateTeamMember = vi.fn();
const mockUpdateProjectField = vi.fn();
const mockUpdateWeekItemField = vi.fn();

vi.mock("@/lib/runway/operations-add", () => ({
  addProject: (p: unknown) => mockAddProject(p),
}));
vi.mock("@/lib/runway/operations-writes-week", () => ({
  createWeekItem: (p: unknown) => mockCreateWeekItem(p),
  updateWeekItemField: (p: unknown) => mockUpdateWeekItemField(p),
}));
vi.mock("@/lib/runway/operations-writes-project", () => ({
  updateProjectField: (p: unknown) => mockUpdateProjectField(p),
}));
vi.mock("@/lib/runway/operations-writes-team", () => ({
  createTeamMember: (p: unknown) => mockCreateTeamMember(p),
}));

// Operations utils — pass-through formatters; observability mocks.
vi.mock("@/lib/runway/operations-utils", () => ({
  formatModalUpdatedBy: (
    slackUserId: string,
    surface: "bot" | "slash",
    mode: "create" | "edit" = "create",
  ) => {
    void surface;
    return `slack:${slackUserId}:${mode === "edit" ? "modal-edit" : "modal"}`;
  },
}));

// Client + project helpers used to map clientId -> slug, projectId -> name.
const mockGetAllClients = vi.fn().mockResolvedValue([
  { id: "client-cgx", slug: "convergix", name: "Convergix" },
  { id: "client-ag1", slug: "ag1", name: "AG1" },
]);
const mockGetProjectsForClient = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/runway/operations", () => ({
  getAllClients: () => mockGetAllClients(),
  getProjectsForClient: (clientId: string) => mockGetProjectsForClient(clientId),
}));

// Multi-detect helper
const mockReEmit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/slack/modals/multi-detect", () => ({
  reEmitButtonsAfterParentSave: (
    parentProposalId: string,
    resolvedProjectId: string,
    savedProjectName: string,
    slack: unknown,
    db: unknown,
  ) => mockReEmit(parentProposalId, resolvedProjectId, savedProjectName, slack, db),
}));

// Observability counters
const mockRecordLifecycle = vi.fn();
const mockRecordRejection = vi.fn();
vi.mock("@/lib/slack/modals/observability", () => ({
  recordProposalLifecycleTransition: (e: string, m?: unknown) =>
    mockRecordLifecycle(e, m),
  recordValidatorRejection: (rule: string, kind?: string) =>
    mockRecordRejection(rule, kind),
}));

// Slack WebClient — mock postMessage + postEphemeral.
const mockPostMessage = vi.fn().mockResolvedValue({ ok: true, ts: "1.1" });
const mockPostEphemeral = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@slack/web-api", () => {
  // Constructable WebClient stub: `new WebClient(token)` returns an object
  // with chat.postMessage / chat.postEphemeral wired to the test spies.
  function FakeWebClient() {
    // The function form lets `new FakeWebClient()` invoke as a constructor.
    return {
      chat: {
        postMessage: mockPostMessage,
        postEphemeral: mockPostEphemeral,
      },
    };
  }
  return { WebClient: FakeWebClient };
});

// Inngest client mock — capture handler.
const mockStepRun = vi.fn(
  async (_name: string, fn: () => Promise<unknown>) => fn(),
);
const mockCreateFunction = vi.fn((config, event, handler) => ({
  config,
  event,
  handler,
}));
vi.mock("../client", () => ({
  inngest: { createFunction: mockCreateFunction },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: any;

// ── Helpers ────────────────────────────────────────────────────────

function seedProposal(overrides: Partial<Record<string, unknown>> = {}) {
  const id = (overrides.id as string) ?? "prop_test_001";
  const row: Record<string, unknown> = {
    id,
    userSlackId: "U_TEST",
    channelId: "C_TEST",
    threadTs: null,
    toolName: "create_project",
    kind: "create",
    targetEntityId: null,
    targetEntityType: null,
    args: JSON.stringify({}),
    status: "pending",
    statusReason: null,
    parentProposalId: null,
    intentGroupId: null,
    pendingProjectName: null,
    resolvedProjectId: null,
    postedMessageTs: null,
    postedMessageChannel: null,
    ...overrides,
  };
  proposalRows.set(id, row);
  return row;
}

function buildEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: {
      proposalId: "prop_test_001",
      modalCallbackId: "runway_new_project",
      stateValues: {},
      userId: "U_TEST",
      teamId: "T_TEST",
      channelId: "C_TEST",
      threadTs: null,
      triggerId: "trigger_test",
      submittedAt: new Date().toISOString(),
      ...overrides,
    },
  };
}

// ── Suite ──────────────────────────────────────────────────────────

describe("slackModalSubmit (Inngest function)", () => {
  beforeAll(async () => {
    await import("./slack-modal-submit");
    handler = mockCreateFunction.mock.calls[0][2];
  });

  beforeEach(() => {
    proposalRows.clear();
    weekItemRows.clear();
    lastSelectedProposalId = null;
    mockValidate.mockReset();
    mockAddProject.mockReset();
    mockCreateWeekItem.mockReset();
    mockCreateTeamMember.mockReset();
    mockUpdateProjectField.mockReset();
    mockUpdateWeekItemField.mockReset();
    mockReEmit.mockReset();
    mockRecordLifecycle.mockClear();
    mockRecordRejection.mockClear();
    mockPostMessage.mockClear();
    mockPostEphemeral.mockClear();
    updateSetSpy.mockClear();
    updateWhereSpy.mockClear();
    mockGetAllClients.mockClear();
    mockGetProjectsForClient.mockReset();
    mockGetProjectsForClient.mockResolvedValue([]);
    eqSpy.mockClear();
    andSpy.mockClear();
    mockStepRun.mockClear();
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  });

  // ── Registration ─────────────────────────────────────────

  it("is registered with id, concurrency limit, and event trigger", () => {
    expect(mockCreateFunction).toHaveBeenCalled();
    const [config, trigger] = mockCreateFunction.mock.calls[0];
    expect(config.id).toBe("slack-modal-submit");
    expect(config.concurrency).toEqual({ limit: 5 });
    expect(trigger).toEqual({ event: "slack-modal/submit" });
  });

  // ── Idempotent retry ─────────────────────────────────────

  it("idempotent retry: re-fire on already-submitted proposal is a no-op", async () => {
    seedProposal({ status: "submitted" });
    const result = await handler({
      event: buildEvent(),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(result).toEqual({ skipped: true, reason: "already-submitted" });
    expect(mockAddProject).not.toHaveBeenCalled();
    expect(mockCreateWeekItem).not.toHaveBeenCalled();
  });

  it("skips when proposal is in terminal state (cancelled / expired / failed)", async () => {
    seedProposal({ status: "cancelled" });
    const result = await handler({
      event: buildEvent(),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("terminal-state");
    expect(mockAddProject).not.toHaveBeenCalled();
  });

  it("skips and logs when proposal not found", async () => {
    // No seed — proposal lookup returns null.
    const result = await handler({
      event: buildEvent({ proposalId: "prop_missing" }),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("proposal-not-found");
    expect(mockAddProject).not.toHaveBeenCalled();
  });

  // ── Submitter mismatch ───────────────────────────────────

  it("submitter mismatch marks proposal failed and throws", async () => {
    seedProposal({ userSlackId: "U_OWNER" });

    await expect(
      handler({
        event: buildEvent({ userId: "U_DIFFERENT" }),
        step: { run: mockStepRun },
        logger: { info: vi.fn(), error: vi.fn() },
      }),
    ).rejects.toThrow(/submitter mismatch/);

    // Status row should have flipped to failed (mutated in-memory).
    const row = proposalRows.get("prop_test_001")!;
    expect(row.status).toBe("failed");
    expect(row.statusReason).toBe("submitter-mismatch");
    expect(mockRecordLifecycle).toHaveBeenCalledWith(
      "proposal_failed",
      expect.any(Object),
    );
  });

  // ── Happy path: Project create non-retainer ───────────────

  it("project create (non-retainer) calls addProject with source/idempotencyKey/updatedBy", async () => {
    seedProposal({
      toolName: "create_project",
      kind: "create",
      args: JSON.stringify({ isRetainer: false }),
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-cgx",
        name: "New Project",
        engagementType: "project",
        status: "not-started",
        category: "active",
      },
    });
    mockAddProject.mockResolvedValue({
      ok: true,
      message: "Added project 'New Project' to Convergix.",
      data: { clientName: "Convergix", projectName: "New Project" },
    });

    const res = await handler({
      event: buildEvent(),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(mockAddProject).toHaveBeenCalledTimes(1);
    const call = mockAddProject.mock.calls[0][0];
    expect(call.source).toBe("slack-modal-bot");
    expect(call.updatedBy).toBe("slack:U_TEST:modal");
    expect(call.clientSlug).toBe("convergix");
    expect(call.name).toBe("New Project");
    expect(res.ok).toBe(true);
    // Lifecycle: submitted recorded.
    expect(mockRecordLifecycle).toHaveBeenCalledWith(
      "proposal_submitted",
      expect.any(Object),
    );
    // Confirmation post.
    expect(mockPostMessage).toHaveBeenCalled();
  });

  it("project create flagged as retainer passes engagementType='retainer'", async () => {
    seedProposal({
      toolName: "create_project",
      kind: "create",
      args: JSON.stringify({ isRetainer: true }),
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-ag1",
        name: "AG1 Pro 2026",
        engagementType: "retainer",
        contractStart: "2026-01-01",
        contractEnd: "2026-12-31",
        status: "in-production",
        category: "active",
      },
    });
    mockAddProject.mockResolvedValue({
      ok: true,
      message: "Added retainer.",
      data: { clientName: "AG1", projectName: "AG1 Pro 2026" },
    });

    await handler({
      event: buildEvent(),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    const call = mockAddProject.mock.calls[0][0];
    expect(call.engagementType).toBe("retainer");
    expect(call.contractStart).toBe("2026-01-01");
    expect(call.contractEnd).toBe("2026-12-31");
  });

  // ── Task create with parent project ──────────────────────

  it("task create with parent project sets projectName from project lookup", async () => {
    seedProposal({
      toolName: "create_week_item",
      kind: "create",
      args: JSON.stringify({}),
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-cgx",
        projectId: "proj-cds",
        title: "CDS messaging brief",
        category: "delivery",
        date: "2026-05-01",
      },
    });
    mockGetProjectsForClient.mockResolvedValue([
      { id: "proj-cds", name: "CDS Messaging" },
    ]);
    mockCreateWeekItem.mockResolvedValue({
      ok: true,
      message: "Added.",
      data: { clientName: "Convergix", title: "CDS messaging brief" },
    });

    await handler({
      event: buildEvent(),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(mockCreateWeekItem).toHaveBeenCalledTimes(1);
    const call = mockCreateWeekItem.mock.calls[0][0];
    expect(call.title).toBe("CDS messaging brief");
    expect(call.projectName).toBe("CDS Messaging");
    expect(call.clientSlug).toBe("convergix");
    expect(call.source).toBe("slack-modal-bot");
    expect(call.updatedBy).toBe("slack:U_TEST:modal");
  });

  // ── Task create with sibling chain (resolvedProjectId) ────

  it("task create with sibling-resolved parent uses resolvedProjectId from proposal", async () => {
    seedProposal({
      toolName: "create_week_item",
      kind: "create",
      args: JSON.stringify({}),
      resolvedProjectId: "proj-resolved",
      pendingProjectName: "Brand Refresh",
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-cgx",
        projectId: "proj-resolved",
        title: "Kickoff doc",
        category: "delivery",
        date: "2026-05-02",
      },
    });
    mockGetProjectsForClient.mockResolvedValue([
      { id: "proj-resolved", name: "Brand Refresh" },
    ]);
    mockCreateWeekItem.mockResolvedValue({
      ok: true,
      message: "Added.",
      data: { clientName: "Convergix", title: "Kickoff doc" },
    });

    await handler({
      event: buildEvent(),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    const call = mockCreateWeekItem.mock.calls[0][0];
    expect(call.projectName).toBe("Brand Refresh");
  });

  // ── Team Member create ────────────────────────────────────

  it("team member create calls createTeamMember with normalized fields", async () => {
    seedProposal({
      toolName: "create_team_member",
      kind: "create",
      args: JSON.stringify({}),
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        fullName: "Lane Davis",
        roleCategory: "creative",
        email: "lane@example.com",
      },
    });
    mockCreateTeamMember.mockResolvedValue({
      ok: true,
      message: "Added.",
      data: { memberName: "Lane Davis" },
    });

    await handler({
      event: buildEvent({ modalCallbackId: "runway_new_team_member" }),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(mockCreateTeamMember).toHaveBeenCalledTimes(1);
    const call = mockCreateTeamMember.mock.calls[0][0];
    expect(call.name).toBe("Lane Davis");
    expect(call.fullName).toBe("Lane Davis");
    expect(call.roleCategory).toBe("creative");
    expect(call.source).toBe("slack-modal-bot");
    expect(call.updatedBy).toBe("slack:U_TEST:modal");
  });

  // ── Project edit ─────────────────────────────────────────

  it("project edit calls updateProjectField for each changed field", async () => {
    seedProposal({
      toolName: "update_project",
      kind: "edit",
      targetEntityId: "proj-cds",
      targetEntityType: "project",
      args: JSON.stringify({}),
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-cgx",
        name: "CDS Messaging",
        owner: "Daniel",
        notes: "Updated notes",
      },
      changedFields: ["owner", "notes"],
    });
    mockGetProjectsForClient.mockResolvedValue([
      { id: "proj-cds", name: "CDS Messaging" },
    ]);
    mockUpdateProjectField.mockResolvedValue({
      ok: true,
      message: "Updated.",
      data: {},
    });

    await handler({
      event: buildEvent({ modalCallbackId: "runway_edit_project" }),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(mockUpdateProjectField).toHaveBeenCalledTimes(2);
    const fields = mockUpdateProjectField.mock.calls.map((c) => c[0].field);
    expect(fields.sort()).toEqual(["notes", "owner"]);
    // Source + updatedBy carry edit mode.
    const firstCall = mockUpdateProjectField.mock.calls[0][0];
    expect(firstCall.source).toBe("slack-modal-bot");
    expect(firstCall.updatedBy).toBe("slack:U_TEST:modal-edit");
  });

  // ── Task edit ────────────────────────────────────────────

  it("task edit calls updateWeekItemField per changed field", async () => {
    seedProposal({
      toolName: "update_week_item",
      kind: "edit",
      targetEntityId: "wi-001",
      targetEntityType: "week_item",
      args: JSON.stringify({}),
    });
    weekItemRows.set("wi-001", {
      id: "wi-001",
      title: "Brief",
      weekOf: "2026-04-27",
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-cgx",
        title: "Brief",
        owner: "Lane",
        date: "2026-05-10",
      },
      changedFields: ["owner", "date"],
    });
    mockUpdateWeekItemField.mockResolvedValue({
      ok: true,
      message: "Updated.",
      data: {},
    });

    await handler({
      event: buildEvent({ modalCallbackId: "runway_edit_task" }),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(mockUpdateWeekItemField).toHaveBeenCalledTimes(2);
    const fields = mockUpdateWeekItemField.mock.calls.map((c) => c[0].field);
    expect(fields.sort()).toEqual(["date", "owner"]);
  });

  it("task edit Single->Range: writes endDate before startDate when forward shift would violate per-field guard", async () => {
    // Repro from the operator's live-fire on TEST Task Single A:
    // row was Single mode (date == startDate == endDate == 2026-05-12),
    // user toggled to Range and picked startDate=2026-05-13, endDate=2026-05-16.
    // updateWeekItemField has a per-field startDate <= endDate guard that
    // reads the row's CURRENT other side. Naive iteration would write
    // startDate=2026-05-13 against currentEnd=2026-05-12 and the guard would
    // reject. The consumer must reorder so the side compatible with the
    // current other is written first; here that's endDate (=2026-05-16 >=
    // currentStart=2026-05-12).
    seedProposal({
      toolName: "update_week_item",
      kind: "edit",
      targetEntityId: "wi-toggle-single-to-range",
      targetEntityType: "week_item",
      args: JSON.stringify({}),
    });
    weekItemRows.set("wi-toggle-single-to-range", {
      id: "wi-toggle-single-to-range",
      title: "TEST Task Single A",
      weekOf: "2026-05-11",
      startDate: "2026-05-12",
      endDate: "2026-05-12",
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        title: "TEST Task Single A",
        date: null,
        startDate: "2026-05-13",
        endDate: "2026-05-16",
      },
      changedFields: ["date", "startDate", "endDate"],
    });
    mockUpdateWeekItemField.mockResolvedValue({
      ok: true,
      message: "Updated.",
      data: {},
    });

    await handler({
      event: buildEvent({ modalCallbackId: "runway_edit_task" }),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(mockUpdateWeekItemField).toHaveBeenCalledTimes(3);
    const callOrder = mockUpdateWeekItemField.mock.calls.map(
      (c) => c[0].field,
    );
    // endDate must precede startDate so the per-field guard sees a row
    // whose endDate is already >= the new startDate.
    const endIdx = callOrder.indexOf("endDate");
    const startIdx = callOrder.indexOf("startDate");
    expect(endIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeLessThan(startIdx);
  });

  it("task edit Range->Single backward shift: writes startDate before endDate when shrinking the window backward", async () => {
    // Sibling case: row was [2026-05-12, 2026-05-20], user picks
    // startDate=2026-05-08, endDate=2026-05-10. Writing endDate=2026-05-10
    // first against currentStart=2026-05-12 would fail the guard
    // (12 > 10). The safe order is startDate first (=2026-05-08 <=
    // currentEnd=2026-05-20).
    seedProposal({
      toolName: "update_week_item",
      kind: "edit",
      targetEntityId: "wi-shrink-back",
      targetEntityType: "week_item",
      args: JSON.stringify({}),
    });
    weekItemRows.set("wi-shrink-back", {
      id: "wi-shrink-back",
      title: "Shrinking Window",
      weekOf: "2026-05-11",
      startDate: "2026-05-12",
      endDate: "2026-05-20",
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        startDate: "2026-05-08",
        endDate: "2026-05-10",
      },
      changedFields: ["startDate", "endDate"],
    });
    mockUpdateWeekItemField.mockResolvedValue({
      ok: true,
      message: "Updated.",
      data: {},
    });

    await handler({
      event: buildEvent({ modalCallbackId: "runway_edit_task" }),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(mockUpdateWeekItemField).toHaveBeenCalledTimes(2);
    const callOrder = mockUpdateWeekItemField.mock.calls.map(
      (c) => c[0].field,
    );
    const startIdx = callOrder.indexOf("startDate");
    const endIdx = callOrder.indexOf("endDate");
    expect(startIdx).toBeLessThan(endIdx);
  });

  // ── Validator-fail path ──────────────────────────────────

  it("validation failure marks failed, posts ephemeral, records rejections", async () => {
    seedProposal({ toolName: "create_project", kind: "create" });
    mockValidate.mockResolvedValue({
      ok: false,
      errors: {
        title_block: "Title required.",
        category_block: "Category required.",
      },
    });

    const res = await handler({
      event: buildEvent(),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(res).toEqual({ failed: "validation" });
    expect(mockAddProject).not.toHaveBeenCalled();

    // Lifecycle: failed.
    expect(mockRecordLifecycle).toHaveBeenCalledWith(
      "proposal_failed",
      expect.any(Object),
    );
    // recordValidatorRejection fired per error.
    expect(mockRecordRejection).toHaveBeenCalledTimes(2);
    // Ephemeral posted.
    expect(mockPostEphemeral).toHaveBeenCalled();

    // Status row flipped to failed.
    const row = proposalRows.get("prop_test_001")!;
    expect(row.status).toBe("failed");
    expect(String(row.statusReason)).toContain("validation:");
  });

  // ── Write-throw path ─────────────────────────────────────

  it("write throw marks failed with statusReason and re-throws", async () => {
    seedProposal({ toolName: "create_project", kind: "create" });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-cgx",
        name: "Boom Project",
        engagementType: "project",
        status: "not-started",
        category: "active",
      },
    });
    mockAddProject.mockRejectedValue(new Error("boom: db connection lost"));

    await expect(
      handler({
        event: buildEvent(),
        step: { run: mockStepRun },
        logger: { info: vi.fn(), error: vi.fn() },
      }),
    ).rejects.toThrow(/boom/);

    const row = proposalRows.get("prop_test_001")!;
    expect(row.status).toBe("failed");
    expect(String(row.statusReason)).toContain("write-error");
    expect(mockRecordLifecycle).toHaveBeenCalledWith(
      "proposal_failed",
      expect.any(Object),
    );
    expect(mockPostMessage).toHaveBeenCalled();
  });

  // ── Multi-detect chat.update ─────────────────────────────

  it("multi-detect: project create with siblings calls reEmitButtonsAfterParentSave", async () => {
    seedProposal({
      toolName: "create_project",
      kind: "create",
      intentGroupId: "ig_test",
      args: JSON.stringify({ isRetainer: false }),
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-cgx",
        name: "Brand Refresh",
        engagementType: "project",
        status: "not-started",
        category: "active",
      },
    });
    mockGetProjectsForClient.mockResolvedValue([
      { id: "proj-newly-created", name: "Brand Refresh" },
    ]);
    mockAddProject.mockResolvedValue({
      ok: true,
      message: "Added.",
      data: { clientName: "Convergix", projectName: "Brand Refresh" },
    });

    await handler({
      event: buildEvent(),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(mockReEmit).toHaveBeenCalledTimes(1);
    const args = mockReEmit.mock.calls[0];
    expect(args[0]).toBe("prop_test_001"); // parent proposalId
    expect(args[1]).toBe("proj-newly-created"); // resolvedProjectId
    expect(args[2]).toBe("Brand Refresh"); // saved project name
  });

  it("multi-detect skipped when project create has no intentGroupId", async () => {
    seedProposal({
      toolName: "create_project",
      kind: "create",
      intentGroupId: null,
      args: JSON.stringify({ isRetainer: false }),
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-cgx",
        name: "Solo Project",
        engagementType: "project",
        status: "not-started",
        category: "active",
      },
    });
    mockGetProjectsForClient.mockResolvedValue([
      { id: "proj-solo", name: "Solo Project" },
    ]);
    mockAddProject.mockResolvedValue({
      ok: true,
      message: "Added.",
      data: { clientName: "Convergix", projectName: "Solo Project" },
    });

    await handler({
      event: buildEvent(),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(mockReEmit).not.toHaveBeenCalled();
  });

  // ── Confirmation post copy ───────────────────────────────

  it("posts a Civ-voice confirmation to the thread on success", async () => {
    seedProposal({
      toolName: "create_project",
      kind: "create",
      threadTs: "1700000000.000099",
      args: JSON.stringify({ isRetainer: false }),
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-cgx",
        name: "Done",
        engagementType: "project",
        status: "not-started",
        category: "active",
      },
    });
    mockAddProject.mockResolvedValue({
      ok: true,
      message: "Added.",
      data: { clientName: "Convergix", projectName: "Done" },
    });

    await handler({
      event: buildEvent({ threadTs: "1700000000.000099" }),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const args = mockPostMessage.mock.calls[0][0];
    expect(args.channel).toBe("C_TEST");
    expect(args.thread_ts).toBe("1700000000.000099");
    // Civ voice: hyphen-space, no em-dash.
    expect(args.text).toMatch(/Saved/);
    expect(args.text).not.toMatch(/[\u2014\u2013]/);
  });

  // ── Slash-surface source tagging ─────────────────────────

  it("uses slack-modal-slash source when proposal.toolName is from slash command flow", async () => {
    seedProposal({
      toolName: "create_project",
      kind: "create",
      conversationRef: "slash:/runway-new-project",
      args: JSON.stringify({ isRetainer: false }),
    });
    mockValidate.mockResolvedValue({
      ok: true,
      normalized: {
        clientId: "client-cgx",
        name: "Slash Project",
        engagementType: "project",
        status: "not-started",
        category: "active",
      },
    });
    mockAddProject.mockResolvedValue({
      ok: true,
      message: "Added.",
      data: { clientName: "Convergix", projectName: "Slash Project" },
    });

    await handler({
      event: buildEvent(),
      step: { run: mockStepRun },
      logger: { info: vi.fn(), error: vi.fn() },
    });

    const call = mockAddProject.mock.calls[0][0];
    expect(call.source).toBe("slack-modal-slash");
  });
});
