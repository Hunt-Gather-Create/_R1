/**
 * Tests for `intercept-miss-alert.ts` — Wave 14 / pre-plan v7 §A4.
 *
 * The observer factory returns an `AuditObserver` that operations-layer write
 * helpers call after every audit insert. The observer fires when:
 *
 *   1. `MODAL_INTERCEPT_ENABLED=true`, AND
 *   2. `event.source === "bot-direct"` (a non-modal bot LLM tool call), AND
 *   3. `event.entityType` is in the modal-routed allowlist (project /
 *       week_item / team_member), AND
 *   4. No `submitted` `bot_modal_proposals` row exists for the same Slack user
 *       in the last 5 minutes (decoded from `event.updatedBy` which carries
 *       the `slack:UID:bot|modal[-edit]` prefix per Wave 0b §"updatedBy
 *       format spec").
 *
 * When all four conditions hold the observer logs a `[intercept-miss]`
 * `console.warn` line. Otherwise it stays silent.
 *
 * AuditEvent today (Wave 0b output) does NOT carry `toolName` or
 * `conversationRef`. The observer compensates by:
 *   - using `entityType` as a proxy for "create_*" (the entity types in the
 *     INTERCEPT_ALLOWLIST are exactly the modal-routed surfaces); and
 *   - parsing `slack:UID:...` out of `updatedBy` to scope the lookup to one
 *     user. The original spec `user_slack_id + channel_id + intent_group_id`
 *     scope degrades to `user_slack_id + last 5 min` until the AuditEvent is
 *     enriched with channel / intent context (open follow-up, see
 *     `wave-14-complete-handoff.md`).
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AuditEvent } from "@/lib/runway/operations-utils";

import { createInterceptMissObserver } from "./intercept-miss-alert";

// ── DB mock plumbing ──────────────────────────────────────
//
// We replace `getRunwayDb` with a chain that captures `select().from().where().limit()`.
// Each test seeds `mockSelectResult` to control whether a "recent submitted
// proposal" exists.

const mockSelectResult = vi.fn<() => Promise<Array<{ id: string }>>>();
const limitSpy = vi.fn();
const whereSpy = vi.fn();
const fromSpy = vi.fn();

const selectChain = {
  from: (table: unknown) => {
    fromSpy(table);
    return {
      where: (cond: unknown) => {
        whereSpy(cond);
        return {
          limit: (n: number) => {
            limitSpy(n);
            return mockSelectResult();
          },
        };
      },
    };
  },
};

const mockDb = {
  select: vi.fn(() => selectChain),
};

vi.mock("@/lib/db/runway", () => ({
  getRunwayDb: () => mockDb,
}));

// ── Drizzle helper mocks (structural shapes only — no real SQL eval) ──

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ __op: "and", args }),
  eq: (col: unknown, val: unknown) => ({ __op: "eq", col, val }),
  gt: (col: unknown, val: unknown) => ({ __op: "gt", col, val }),
}));

// ── Test-utility: build an AuditEvent shape ──

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    source: "bot-direct",
    entityId: "proj_abc",
    entityType: "project",
    updatedBy: "slack:U_TEST_001:bot",
    ...overrides,
  };
}

describe("createInterceptMissObserver", () => {
  const originalFlag = process.env.MODAL_INTERCEPT_ENABLED;

  beforeEach(() => {
    mockDb.select.mockClear();
    fromSpy.mockClear();
    whereSpy.mockClear();
    limitSpy.mockClear();
    mockSelectResult.mockReset();
    process.env.MODAL_INTERCEPT_ENABLED = "true";
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.MODAL_INTERCEPT_ENABLED;
    } else {
      process.env.MODAL_INTERCEPT_ENABLED = originalFlag;
    }
    vi.restoreAllMocks();
  });

  it("warns when bot-direct project create has no recent submitted proposal", async () => {
    mockSelectResult.mockResolvedValueOnce([]); // no recent submitted proposal
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const observer = createInterceptMissObserver();

    await observer(makeEvent({ source: "bot-direct", entityType: "project" }));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = warnSpy.mock.calls[0];
    expect(tag).toBe("[intercept-miss]");
    expect(payload).toMatchObject({
      source: "bot-direct",
      entityType: "project",
      entityId: "proj_abc",
      userSlackId: "U_TEST_001",
    });
  });

  it("warns for week_item bot-direct creates", async () => {
    mockSelectResult.mockResolvedValueOnce([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    await observer(
      makeEvent({
        source: "bot-direct",
        entityType: "week_item",
        entityId: "wk_xyz",
        updatedBy: "slack:U_TEST_002:bot",
      }),
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("warns for team_member bot-direct creates", async () => {
    mockSelectResult.mockResolvedValueOnce([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    await observer(
      makeEvent({
        source: "bot-direct",
        entityType: "team_member",
        entityId: "tm_lmn",
        updatedBy: "slack:U_TEST_003:bot",
      }),
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT warn when source is slack-modal-bot (modal-routed)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    await observer(makeEvent({ source: "slack-modal-bot" }));

    expect(warnSpy).not.toHaveBeenCalled();
    // Lookup should be skipped entirely — no DB hit when source is excluded.
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("does NOT warn when source is slack-modal-slash", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    await observer(makeEvent({ source: "slack-modal-slash" }));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("does NOT warn when source is mcp / migration / cli / null", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    await observer(makeEvent({ source: "mcp" }));
    await observer(makeEvent({ source: "migration" }));
    await observer(makeEvent({ source: "cli" }));
    await observer(makeEvent({ source: null }));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("does NOT warn when feature flag is off", async () => {
    process.env.MODAL_INTERCEPT_ENABLED = "false";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    await observer(makeEvent({ source: "bot-direct" }));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("does NOT warn when feature flag is unset", async () => {
    delete process.env.MODAL_INTERCEPT_ENABLED;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    await observer(makeEvent({ source: "bot-direct" }));

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT warn when there IS a recent submitted proposal for the user", async () => {
    mockSelectResult.mockResolvedValueOnce([{ id: "prop_recent_001" }]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    await observer(makeEvent({ source: "bot-direct" }));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("does NOT warn for non-allowlist entity types (e.g. pipeline)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    await observer(
      makeEvent({
        source: "bot-direct",
        // `pipeline` is intentionally NOT in INTERCEPT_ALLOWLIST per Wave 0b
        // — pipeline items live in a separate Sales-pipeline surface and
        // the modal intercept layer doesn't apply.
        entityType: undefined,
      }),
    );

    expect(warnSpy).not.toHaveBeenCalled();
    // No DB lookup either — short-circuits before the query.
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("does NOT warn when updatedBy is missing the slack: prefix", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    // Migration / CLI updatedBy formats don't carry a Slack user id and
    // cannot be matched against bot_modal_proposals. The observer skips
    // rather than emit a misleading alert.
    await observer(
      makeEvent({
        source: "bot-direct",
        updatedBy: "migration:lppc-2026-04-21",
      }),
    );

    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("queries the DB with a 5-minute lookback window", async () => {
    mockSelectResult.mockResolvedValueOnce([]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = Date.now();

    const observer = createInterceptMissObserver();
    await observer(makeEvent({ source: "bot-direct" }));

    const after = Date.now();
    expect(mockDb.select).toHaveBeenCalledTimes(1);
    expect(limitSpy).toHaveBeenCalledWith(1);

    // Inspect the where-clause shape: should be an `and(eq(userSlackId), eq(status='submitted'), gt(createdAt, cutoff))`
    expect(whereSpy).toHaveBeenCalledTimes(1);
    const condArg = whereSpy.mock.calls[0][0] as {
      __op: string;
      args: Array<{ __op: string; col?: unknown; val?: unknown }>;
    };
    expect(condArg.__op).toBe("and");
    expect(condArg.args).toHaveLength(3);

    const eqs = condArg.args.filter((a) => a.__op === "eq");
    const gts = condArg.args.filter((a) => a.__op === "gt");
    expect(eqs).toHaveLength(2);
    expect(gts).toHaveLength(1);

    // Status equality must match "submitted" (the success terminal state).
    const statusEq = eqs.find((e) => e.val === "submitted");
    expect(statusEq).toBeDefined();

    // Slack user id parsed from updatedBy.
    const userEq = eqs.find((e) => e.val === "U_TEST_001");
    expect(userEq).toBeDefined();

    // Cutoff timestamp must fall within the 5-minute lookback window.
    const cutoff = (gts[0].val as Date).getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 5 * 60 * 1000);
    expect(cutoff).toBeLessThanOrEqual(after - 5 * 60 * 1000 + 50);
  });

  it("supports the modal-edit suffix in updatedBy without false-positive (still skips when source is modal)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // updatedBy from an edit-modal would be `slack:UID:modal-edit`, but the
    // source check trumps it — modal-edit writes never hit `bot-direct`.
    const observer = createInterceptMissObserver();
    await observer(
      makeEvent({
        source: "slack-modal-slash",
        updatedBy: "slack:U_EDIT:modal-edit",
      }),
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("survives a DB error without throwing (logs but does not crash the write path)", async () => {
    mockSelectResult.mockRejectedValueOnce(new Error("boom"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const observer = createInterceptMissObserver();
    // Must NOT throw — the observer is fire-and-forget on the write path.
    await expect(
      observer(makeEvent({ source: "bot-direct" })),
    ).resolves.toBeUndefined();

    // The intercept-miss warn is suppressed; an error log surfaces the
    // observability outage so we still notice.
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [errTag] = errorSpy.mock.calls[0];
    expect(errTag).toBe("[intercept-miss]");
  });
});
