/**
 * Tests for `observability.ts` — counters used to instrument the Slack modal
 * funnel. Strategy is in-memory counters + structured `console.log` lines
 * (lightest path; consumed by log aggregation). Tests assert:
 *
 *   - Each counter helper increments the right bucket exactly once per call.
 *   - Snapshots return a frozen-shape object so assertion code can structurally
 *     compare without coupling to Map internals.
 *   - The reset helper clears every bucket so test isolation works.
 *   - Each helper emits a single structured `console.log` line tagged
 *     `[modal-metrics]` so log aggregators can filter on it.
 *   - Multi-detect bucket-clamping: any `N >= 4` rolls into the `4+` bucket so
 *     the cardinality stays bounded as fan-out grows.
 *
 * Runs as a pure unit test — no DB, no Slack mock, no env mutation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordMultiDetectFanOut,
  recordProposalLifecycleTransition,
  recordValidatorRejection,
  resetMetrics,
  snapshotMetrics,
} from "./observability";

describe("recordProposalLifecycleTransition", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
    vi.restoreAllMocks();
  });

  it("increments the proposal_created bucket", () => {
    recordProposalLifecycleTransition("proposal_created");
    const snap = snapshotMetrics();
    expect(snap.proposalLifecycle.proposal_created).toBe(1);
    expect(snap.proposalLifecycle.proposal_submitted).toBe(0);
    expect(snap.proposalLifecycle.proposal_cancelled).toBe(0);
    expect(snap.proposalLifecycle.proposal_expired).toBe(0);
    expect(snap.proposalLifecycle.proposal_failed).toBe(0);
  });

  it("increments multiple lifecycle buckets independently", () => {
    recordProposalLifecycleTransition("proposal_created");
    recordProposalLifecycleTransition("proposal_created");
    recordProposalLifecycleTransition("proposal_submitted");
    recordProposalLifecycleTransition("proposal_cancelled");
    recordProposalLifecycleTransition("proposal_expired");
    recordProposalLifecycleTransition("proposal_failed");
    recordProposalLifecycleTransition("proposal_failed");

    const snap = snapshotMetrics();
    expect(snap.proposalLifecycle.proposal_created).toBe(2);
    expect(snap.proposalLifecycle.proposal_submitted).toBe(1);
    expect(snap.proposalLifecycle.proposal_cancelled).toBe(1);
    expect(snap.proposalLifecycle.proposal_expired).toBe(1);
    expect(snap.proposalLifecycle.proposal_failed).toBe(2);
  });

  it("emits a structured log line tagged [modal-metrics]", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    recordProposalLifecycleTransition("proposal_submitted", {
      proposalId: "prop_xxx",
      toolName: "create_project",
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = logSpy.mock.calls[0];
    expect(tag).toBe("[modal-metrics]");
    expect(payload).toMatchObject({
      kind: "proposal_lifecycle",
      event: "proposal_submitted",
      proposalId: "prop_xxx",
      toolName: "create_project",
    });
  });
});

describe("recordValidatorRejection", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
    vi.restoreAllMocks();
  });

  it("increments per-rule rejection counts", () => {
    recordValidatorRejection("validateRoleTagOnResources");
    recordValidatorRejection("validateRoleTagOnResources");
    recordValidatorRejection("validateStatusCategoryCompatibility");

    const snap = snapshotMetrics();
    expect(snap.validatorRejections.validateRoleTagOnResources).toBe(2);
    expect(snap.validatorRejections.validateStatusCategoryCompatibility).toBe(1);
  });

  it("returns 0 for rules never seen", () => {
    const snap = snapshotMetrics();
    expect(snap.validatorRejections.unknownRule).toBeUndefined();
  });

  it("emits a structured log line carrying rule + modalKind", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    recordValidatorRejection("validateRoleTagOnResources", "task");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = logSpy.mock.calls[0];
    expect(tag).toBe("[modal-metrics]");
    expect(payload).toMatchObject({
      kind: "validator_rejection",
      rule: "validateRoleTagOnResources",
      modalKind: "task",
    });
  });

  it("modalKind is optional", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    recordValidatorRejection("validateNotesMaxLength");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = logSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.modalKind).toBeUndefined();
    expect(payload.rule).toBe("validateNotesMaxLength");
  });
});

describe("recordMultiDetectFanOut", () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
    vi.restoreAllMocks();
  });

  it("increments the N=2 bucket for two-item fan-outs", () => {
    recordMultiDetectFanOut(2, "ig_001");
    const snap = snapshotMetrics();
    expect(snap.multiDetectFanOut["2"]).toBe(1);
    expect(snap.multiDetectFanOut["3"]).toBe(0);
    expect(snap.multiDetectFanOut["4+"]).toBe(0);
  });

  it("increments the N=3 bucket for three-item fan-outs", () => {
    recordMultiDetectFanOut(3, "ig_002");
    const snap = snapshotMetrics();
    expect(snap.multiDetectFanOut["3"]).toBe(1);
  });

  it("clamps N>=4 into the 4+ bucket", () => {
    recordMultiDetectFanOut(4, "ig_003");
    recordMultiDetectFanOut(5, "ig_004");
    recordMultiDetectFanOut(12, "ig_005");
    const snap = snapshotMetrics();
    expect(snap.multiDetectFanOut["4+"]).toBe(3);
  });

  it("ignores N<2 (single-detect is not a fan-out)", () => {
    recordMultiDetectFanOut(0, "ig_006");
    recordMultiDetectFanOut(1, "ig_007");
    const snap = snapshotMetrics();
    expect(snap.multiDetectFanOut["2"]).toBe(0);
    expect(snap.multiDetectFanOut["3"]).toBe(0);
    expect(snap.multiDetectFanOut["4+"]).toBe(0);
  });

  it("emits a structured log line carrying intentGroupId + bucketed N", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    recordMultiDetectFanOut(7, "ig_log_001");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = logSpy.mock.calls[0];
    expect(tag).toBe("[modal-metrics]");
    expect(payload).toMatchObject({
      kind: "multi_detect_fan_out",
      n: 7,
      bucket: "4+",
      intentGroupId: "ig_log_001",
    });
  });

  it("does not log for N<2", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    recordMultiDetectFanOut(1, "ig_skip");
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("snapshotMetrics + resetMetrics", () => {
  it("snapshot is independent of subsequent mutations (frozen copy)", () => {
    resetMetrics();
    recordProposalLifecycleTransition("proposal_created");
    const snap1 = snapshotMetrics();
    expect(snap1.proposalLifecycle.proposal_created).toBe(1);

    recordProposalLifecycleTransition("proposal_created");
    expect(snap1.proposalLifecycle.proposal_created).toBe(1);

    const snap2 = snapshotMetrics();
    expect(snap2.proposalLifecycle.proposal_created).toBe(2);
  });

  it("resetMetrics zeros every bucket across kinds", () => {
    recordProposalLifecycleTransition("proposal_created");
    recordValidatorRejection("ruleA");
    recordMultiDetectFanOut(3, "ig_reset");

    resetMetrics();

    const snap = snapshotMetrics();
    expect(snap.proposalLifecycle.proposal_created).toBe(0);
    expect(snap.proposalLifecycle.proposal_submitted).toBe(0);
    expect(snap.proposalLifecycle.proposal_cancelled).toBe(0);
    expect(snap.proposalLifecycle.proposal_expired).toBe(0);
    expect(snap.proposalLifecycle.proposal_failed).toBe(0);
    expect(snap.validatorRejections).toEqual({});
    expect(snap.multiDetectFanOut["2"]).toBe(0);
    expect(snap.multiDetectFanOut["3"]).toBe(0);
    expect(snap.multiDetectFanOut["4+"]).toBe(0);
  });
});
