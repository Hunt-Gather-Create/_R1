/**
 * Tests for `checkConcurrentProposal` (Wave 11 / Builder 11).
 *
 * The helper queries the `bot_modal_proposals` table for OTHER pending
 * proposals in the same channel, same toolName, within the last 60 seconds,
 * and runs `fuzzyMatchCandidates` against the title extracted from each
 * candidate's `args` JSON.
 *
 * The DB layer is stubbed via the same drizzle-eq-sentinel pattern used in
 * the interactivity route tests so this spec is hermetic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeProposalRow = {
  id: string;
  toolName: string;
  channelId: string;
  userSlackId: string;
  status: "pending" | "submitted" | "cancelled" | "expired" | "failed";
  args: string;
  createdAt: Date;
};

function makeRow(overrides: Partial<FakeProposalRow> = {}): FakeProposalRow {
  return {
    id: `prop_${Math.random().toString(36).slice(2, 10)}`,
    toolName: "create_week_item",
    channelId: "C_TEST_001",
    userSlackId: "U_OTHER",
    status: "pending",
    args: JSON.stringify({ title: "Default Task" }),
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Build a fake `getRunwayDb()` whose select chain returns the supplied rows
 * regardless of filters — the helper itself does the filtering in JS so we
 * don't need to model SQL semantics. This keeps the test honest about the
 * helper's actual behavior (it's the helper that decides which rows match,
 * not the stub).
 */
function setupConcurrencyMocks(rows: FakeProposalRow[]) {
  vi.resetModules();
  vi.doMock("drizzle-orm", async () => {
    const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
    return {
      ...actual,
      eq: () => ({ _kind: "eq" }),
      and: (...args: unknown[]) => ({ _kind: "and", args }),
      gt: () => ({ _kind: "gt" }),
      ne: () => ({ _kind: "ne" }),
    };
  });
  vi.doMock("@/lib/db/runway", () => ({
    getRunwayDb: () => ({
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(rows),
        }),
      }),
    }),
  }));
}

describe("checkConcurrentProposal", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns hasConcurrent=false when no candidate rows are in the table", async () => {
    setupConcurrencyMocks([]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "Draft homepage hero",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(false);
  });

  it("excludes rows authored by the current user", async () => {
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_ME", // same user — skip
        args: JSON.stringify({ title: "Draft homepage hero" }),
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "Draft homepage hero",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(false);
  });

  it("returns hasConcurrent=true with metadata when another user has a fuzzy-matching pending proposal in same channel within window", async () => {
    const recent = new Date(Date.now() - 10_000); // 10s ago
    setupConcurrencyMocks([
      makeRow({
        id: "prop_other",
        userSlackId: "U_OTHER",
        channelId: "C_TEST_001",
        toolName: "create_week_item",
        args: JSON.stringify({ title: "Draft homepage hero" }),
        createdAt: recent,
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "Draft homepage hero", // exact match - dice = 1
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(true);
    if (result.hasConcurrent) {
      expect(result.otherUser).toBe("U_OTHER");
      expect(result.otherTitle).toBe("Draft homepage hero");
      expect(result.createdAt.getTime()).toBe(recent.getTime());
    }
  });

  it("excludes rows older than 60 seconds (window edge)", async () => {
    const stale = new Date(Date.now() - 61_000); // 61s ago - just outside
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_OTHER",
        args: JSON.stringify({ title: "Draft homepage hero" }),
        createdAt: stale,
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "Draft homepage hero",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(false);
  });

  it("excludes rows in a different channel", async () => {
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_OTHER",
        channelId: "C_DIFFERENT",
        args: JSON.stringify({ title: "Draft homepage hero" }),
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "Draft homepage hero",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(false);
  });

  it("excludes rows with a different toolName (task vs project)", async () => {
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_OTHER",
        toolName: "create_project",
        args: JSON.stringify({ name: "Draft homepage hero" }),
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "Draft homepage hero",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(false);
  });

  it("excludes rows whose title does not fuzzy-match (below threshold)", async () => {
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_OTHER",
        args: JSON.stringify({ title: "Completely unrelated kickoff" }),
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "Draft homepage hero",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(false);
  });

  it("uses `name` field from args for project toolName", async () => {
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_OTHER",
        toolName: "create_project",
        args: JSON.stringify({ name: "Website Build" }),
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_project",
      fuzzyTitle: "Website Build",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(true);
    if (result.hasConcurrent) {
      expect(result.otherTitle).toBe("Website Build");
    }
  });

  it("uses `fullName` field from args for team_member toolName", async () => {
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_OTHER",
        toolName: "create_team_member",
        args: JSON.stringify({ fullName: "Sam Rivera" }),
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_team_member",
      fuzzyTitle: "Sam Rivera",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(true);
    if (result.hasConcurrent) {
      expect(result.otherTitle).toBe("Sam Rivera");
    }
  });

  it("returns hasConcurrent=false when fuzzyTitle is empty (nothing to match against)", async () => {
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_OTHER",
        args: JSON.stringify({ title: "Some Task" }),
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(false);
  });

  it("handles candidate rows with empty / missing title field gracefully", async () => {
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_OTHER",
        args: JSON.stringify({}), // no title
      }),
      makeRow({
        userSlackId: "U_OTHER",
        args: "not valid json", // malformed
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "Draft homepage hero",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(false);
  });

  it("excludes already-cancelled / submitted rows (status != pending)", async () => {
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_OTHER",
        status: "cancelled",
        args: JSON.stringify({ title: "Draft homepage hero" }),
      }),
      makeRow({
        userSlackId: "U_OTHER",
        status: "submitted",
        args: JSON.stringify({ title: "Draft homepage hero" }),
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "Draft homepage hero",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(false);
  });

  it("matches case-insensitively (delegated to fuzzyMatchCandidates)", async () => {
    setupConcurrencyMocks([
      makeRow({
        userSlackId: "U_OTHER",
        args: JSON.stringify({ title: "draft HOMEPAGE hero" }),
      }),
    ]);
    const { checkConcurrentProposal } = await import("./concurrency-check");

    const result = await checkConcurrentProposal({
      toolName: "create_week_item",
      fuzzyTitle: "DRAFT homepage HERO",
      currentUserSlackId: "U_ME",
      currentChannelId: "C_TEST_001",
    });
    expect(result.hasConcurrent).toBe(true);
  });
});
