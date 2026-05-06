/**
 * Slack Modal observability counters — Wave 14 (pre-plan v7 §"Wave 14",
 * "Funnel observability").
 *
 * Strategy: lightweight in-memory counters paired with structured
 * `console.log` lines tagged `[modal-metrics]`. Picked over a dedicated
 * `slack_modal_metrics` DB table for two reasons:
 *
 *   1. No new schema or migration required — Phase 2 stays additive.
 *   2. Vercel's runtime log aggregation already ingests `console.*` output, so
 *      a structured tag is enough for ad-hoc queries / dashboards. If we ever
 *      need durable per-15-min rollups we can layer a flush job on top of
 *      `snapshotMetrics()` without changing the call sites.
 *
 * Three counter families per pre-plan v7 §"Wave 14":
 *
 *   - `proposal_lifecycle`     — counts of `bot_modal_proposals.status` flips
 *                                 (created / submitted / cancelled / expired /
 *                                 failed). Drives funnel-conversion metrics.
 *   - `validator_rejection`    — per-validator-rule rejection counts. Tells us
 *                                 which rule is firing most often (e.g. role-
 *                                 tagged-resources catching most modal flubs).
 *   - `multi_detect_fan_out`   — bucketed N from natural-language LLM intent
 *                                 detection (N=2 / N=3 / N=4+). Tells us how
 *                                 often users stack multi-create.
 *
 * Counters are process-local. Multiple Vercel function instances each track
 * their own; aggregation happens at the log-ingest layer. `resetMetrics()`
 * exists for test isolation.
 */

// ── Lifecycle event keys (mirrors bot_modal_proposals.status enum) ──

export type ProposalLifecycleEvent =
  | "proposal_created"
  | "proposal_submitted"
  | "proposal_cancelled"
  | "proposal_expired"
  | "proposal_failed";

const ALL_LIFECYCLE_EVENTS: ProposalLifecycleEvent[] = [
  "proposal_created",
  "proposal_submitted",
  "proposal_cancelled",
  "proposal_expired",
  "proposal_failed",
];

type LifecycleCounts = Record<ProposalLifecycleEvent, number>;
type FanOutBucket = "2" | "3" | "4+";
type FanOutCounts = Record<FanOutBucket, number>;

// ── Module-local counter state ────────────────────────────

const lifecycleCounts: LifecycleCounts = {
  proposal_created: 0,
  proposal_submitted: 0,
  proposal_cancelled: 0,
  proposal_expired: 0,
  proposal_failed: 0,
};

const validatorRejectionCounts: Record<string, number> = {};

const multiDetectFanOutCounts: FanOutCounts = {
  "2": 0,
  "3": 0,
  "4+": 0,
};

const LOG_TAG = "[modal-metrics]";

// ── Counter helpers ──────────────────────────────────────

/**
 * Record a transition in the proposal lifecycle (i.e. a `bot_modal_proposals`
 * row flipping into a new status). Increments the in-memory counter and emits
 * a structured `[modal-metrics]` log line with optional metadata so log
 * aggregation can correlate against `bot_modal_proposals` rows by id.
 *
 * Wired in:
 *   - `proposal_created`   — `insertProposal()` (Wave 3 / Builder 3 + Wave 7)
 *   - `proposal_submitted` — view_submission handler (Wave 10 / Builder 10)
 *   - `proposal_cancelled` — view_closed handler (Wave 11 / Builder 11)
 *   - `proposal_expired`   — Inngest expiry sweeper (Wave 12 / Builder 12)
 *   - `proposal_failed`    — view_submission catch-block (Wave 10)
 */
export function recordProposalLifecycleTransition(
  event: ProposalLifecycleEvent,
  metadata?: Record<string, unknown>,
): void {
  lifecycleCounts[event] += 1;
  console.log(LOG_TAG, {
    kind: "proposal_lifecycle",
    event,
    ...(metadata ?? {}),
  });
}

/**
 * Record a Wave 0b validator rejection. `rule` is the validator function name
 * (e.g. `validateRoleTagOnResources`). `modalKind` is the surface that fired
 * the rejection (`"task" | "project" | "team"`) — optional because some
 * validators run outside a modal context (CLI, MCP).
 */
export function recordValidatorRejection(
  rule: string,
  modalKind?: string,
): void {
  validatorRejectionCounts[rule] = (validatorRejectionCounts[rule] ?? 0) + 1;
  console.log(LOG_TAG, {
    kind: "validator_rejection",
    rule,
    ...(modalKind === undefined ? {} : { modalKind }),
  });
}

/**
 * Record a multi-detect fan-out — how many proposals the LLM intent extractor
 * staged from a single user message. Bucketed into `2 / 3 / 4+` to keep
 * cardinality bounded as fan-out grows. `N < 2` is silently ignored (single
 * detect is not a fan-out and isn't worth a log line).
 */
export function recordMultiDetectFanOut(
  N: number,
  intentGroupId: string,
): void {
  if (N < 2) return;
  const bucket: FanOutBucket = N === 2 ? "2" : N === 3 ? "3" : "4+";
  multiDetectFanOutCounts[bucket] += 1;
  console.log(LOG_TAG, {
    kind: "multi_detect_fan_out",
    n: N,
    bucket,
    intentGroupId,
  });
}

// ── Snapshot + reset (test isolation + future flush-job hook) ────

export interface MetricsSnapshot {
  proposalLifecycle: LifecycleCounts;
  validatorRejections: Record<string, number>;
  multiDetectFanOut: FanOutCounts;
}

/**
 * Return a structural copy of the current counter state. Mutating the
 * returned object does NOT affect the live counters; subsequent record-calls
 * advance the live counters independently. Useful for tests + a future
 * cron-driven flush job that periodically POSTs counter rollups somewhere
 * durable (out of scope for Phase 2).
 */
export function snapshotMetrics(): MetricsSnapshot {
  return {
    proposalLifecycle: { ...lifecycleCounts },
    validatorRejections: { ...validatorRejectionCounts },
    multiDetectFanOut: { ...multiDetectFanOutCounts },
  };
}

/**
 * Zero every counter. Test-only helper so each spec starts from a clean
 * baseline; production code does not call this.
 */
export function resetMetrics(): void {
  for (const ev of ALL_LIFECYCLE_EVENTS) {
    lifecycleCounts[ev] = 0;
  }
  for (const key of Object.keys(validatorRejectionCounts)) {
    delete validatorRejectionCounts[key];
  }
  multiDetectFanOutCounts["2"] = 0;
  multiDetectFanOutCounts["3"] = 0;
  multiDetectFanOutCounts["4+"] = 0;
}
