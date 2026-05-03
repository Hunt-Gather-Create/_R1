/**
 * Tests for Slack test helpers — fixture loader + mutator.
 *
 * Builder 0c (Wave 0c): tests must use real-shape Slack payloads. Helpers
 * in `test-helpers.ts` expose `loadFixture()` to read sanitized JSON from
 * `tests/fixtures/slack/` and `mutateFixture()` to deep-merge per-test overrides.
 */
import { describe, it, expect } from "vitest";
import {
  loadFixture,
  mutateFixture,
  makeSlackSignature,
  nowTimestamp,
} from "./test-helpers";

describe("makeSlackSignature / nowTimestamp (existing)", () => {
  it("nowTimestamp returns a string of digits", () => {
    const ts = nowTimestamp();
    expect(ts).toMatch(/^\d+$/);
  });

  it("makeSlackSignature returns a v0= prefixed hex", () => {
    const sig = makeSlackSignature("secret", "1700000000", "body");
    expect(sig).toMatch(/^v0=[0-9a-f]{64}$/);
  });
});

describe("loadFixture", () => {
  it("loads the view-submission-task fixture and exposes top-level Slack keys", () => {
    const fx = loadFixture<{
      type: string;
      team: { id: string };
      user: { id: string };
      view: { callback_id: string; private_metadata: string };
    }>("view-submission-task");

    expect(fx.type).toBe("view_submission");
    expect(fx.team.id).toBe("T_TEST_001");
    expect(fx.user.id).toBe("U_TEST_001");
    expect(fx.view.callback_id).toBe("runway_new_task");
    // private_metadata is a JSON-encoded string per Slack convention
    const meta = JSON.parse(fx.view.private_metadata);
    expect(meta.proposalId).toMatch(/^prop_/);
  });

  it("loads the block-actions-button-click fixture with action shape", () => {
    const fx = loadFixture<{
      type: string;
      actions: Array<{ action_id: string; value: string }>;
      trigger_id: string;
    }>("block-actions-button-click");
    expect(fx.type).toBe("block_actions");
    expect(fx.actions[0].action_id).toBe("open_create_modal");
    expect(fx.actions[0].value).toMatch(/^prop_/);
    expect(fx.trigger_id).toMatch(/^[0-9]+\.[0-9]+\.[0-9a-f]+$/);
  });

  it("loads the multi-detect-chain fixture as a 3-stage array", () => {
    const fx = loadFixture<
      Array<{ stage: string; payload: Record<string, unknown> }>
    >("block-actions-multi-detect-chain");
    expect(Array.isArray(fx)).toBe(true);
    expect(fx).toHaveLength(3);
    expect(fx[0].stage).toBe("project-button-click");
    expect(fx[1].stage).toBe("chat-update-after-project-saved");
    expect(fx[2].stage).toBe("child-task-button-click");
  });

  it("throws on missing fixture", () => {
    expect(() => loadFixture("does-not-exist")).toThrow();
  });
});

describe("mutateFixture", () => {
  it("deep-merges overrides without mutating original", () => {
    const fx = loadFixture<{
      type: string;
      user: { id: string; username: string };
    }>("view-submission-task");
    const originalUserId = fx.user.id;

    const mutated = mutateFixture(fx, {
      user: { id: "U_TEST_OVERRIDE" },
    });

    expect(mutated.user.id).toBe("U_TEST_OVERRIDE");
    // username preserved from original (deep-merge, not replace)
    expect(mutated.user.username).toBe(fx.user.username);
    // original untouched
    expect(fx.user.id).toBe(originalUserId);
  });

  it("supports overriding nested fields", () => {
    const base = { a: { b: { c: 1, d: 2 } }, e: 5 };
    const out = mutateFixture(base, { a: { b: { c: 99 } } });
    expect(out).toEqual({ a: { b: { c: 99, d: 2 } }, e: 5 });
    // original untouched
    expect(base.a.b.c).toBe(1);
  });

  it("replaces arrays wholesale (does not deep-merge arrays)", () => {
    const base = { tags: ["a", "b", "c"], other: 1 };
    const out = mutateFixture(base, { tags: ["x"] });
    expect(out.tags).toEqual(["x"]);
    expect(out.other).toBe(1);
  });
});
