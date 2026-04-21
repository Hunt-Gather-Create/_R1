/**
 * Runway Mutation Response shape — shared, structured response
 * for every write operation exposed through `operations.ts`.
 *
 * Goal: callers (MCP tools, Slack bot, UI server actions) can parse
 * JSON fields rather than scrape prose out of `message`. Introduced in
 * PR #86 to surface cascade outcomes to AI consumers without changing
 * any of the existing `message` / `ok` / `data.*` contracts.
 *
 * Backward-compatibility guarantees:
 * - `ok: true` responses always include `message` (unchanged).
 * - `ok: false` responses always include `error` (and optional
 *   `available`) (unchanged).
 * - Existing `data` fields used by callers today (e.g.
 *   `cascadedItems: string[]`, `reverseCascaded: boolean`,
 *   `clientName`, `projectName`, `previousValue`, `newValue`, …)
 *   are preserved verbatim.
 *
 * What's NEW:
 * - Typed per-mutation `data` payloads.
 * - `cascadeDetail: CascadedItemInfo[]` — per-item trace of forward
 *   cascades (project -> week items) with audit ids so consumers can
 *   link back to `updates` rows without querying.
 * - `reverseCascadeDetail: ReverseCascadeInfo | null` — structured info
 *   when a deadline L2 date change cascades back to the parent project's
 *   `dueDate`.
 *
 * The existing loose `OperationResult` type (in `operations-utils.ts`)
 * remains the runtime union these typed responses are assignable to, so
 * callers that currently accept `OperationResult` keep compiling.
 */
import type { OperationResult } from "./operations-utils";

// ── Cascade detail types ────────────────────────────────

/**
 * Per-item trace of a forward cascade from a project status/dueDate change
 * down to one of its linked week items. Populated by:
 * - `updateProjectStatus` when the new status is in `CASCADE_STATUSES`.
 * - `updateProjectField` when the field is `dueDate`.
 */
export type CascadedItemInfo = {
  /** Week item id. */
  itemId: string;
  /** Week item title (as of the mutation). */
  itemTitle: string;
  /** Which L2 field was overwritten by the cascade. */
  field: "status" | "date";
  /** Prior L2 value (null if unset). */
  previousValue: string | null;
  /** New L2 value applied by the cascade. */
  newValue: string;
  /** Audit row id for the cascade entry; links back via `triggeredByUpdateId`. */
  auditId: string;
};

/**
 * Structured info emitted when a deadline L2 date change reverse-cascades
 * to the parent project's `dueDate`. Populated by `updateWeekItemField`
 * when `field === "date"` and `item.category === "deadline"` and the item
 * has a parent projectId.
 */
export type ReverseCascadeInfo = {
  /** Parent L1 id. */
  projectId: string;
  /** Parent L1 name (as of the mutation). */
  projectName: string;
  /** Always `dueDate` today — kept explicit for forward-compatibility. */
  field: "dueDate";
  /** Prior dueDate on the parent (null if unset). */
  previousDueDate: string | null;
  /** New dueDate applied (mirrors the L2's new `date`). */
  newDueDate: string;
  /**
   * Audit row id of the `week-field-change` row that triggered the reverse
   * cascade. Today there is no separate audit row for the parent project
   * update (the week item write owns the audit trail), so this doubles as
   * the link-back id for the reverse cascade itself.
   */
  auditId: string;
};

// ── Per-mutation data payloads ──────────────────────────

/** `data` payload for a successful `updateProjectStatus`. */
export interface UpdateProjectStatusData extends Record<string, unknown> {
  clientName: string;
  projectName: string;
  previousStatus: string;
  newStatus: string;
  /** Cascaded L2 titles (back-compat: `string[]`). */
  cascadedItems: string[];
  /** Structured per-item cascade trace (new in PR #86). */
  cascadeDetail: CascadedItemInfo[];
  /** Audit row id for the parent `status-change` record (new in PR #86). */
  auditId?: string;
}

/** `data` payload for a successful `updateProjectField`. */
export interface UpdateProjectFieldData extends Record<string, unknown> {
  clientName: string;
  projectName: string;
  field: string;
  previousValue: string;
  newValue: string;
  /** Cascaded L2 titles — only populated when `field === "dueDate"`. */
  cascadedItems: string[];
  /** Structured per-item cascade trace — empty unless `field === "dueDate"`. */
  cascadeDetail: CascadedItemInfo[];
  /** Audit row id for the parent `field-change` record. */
  auditId?: string;
}

/** `data` payload for a successful `updateWeekItemField`. */
export interface UpdateWeekItemFieldData extends Record<string, unknown> {
  weekItemTitle: string;
  field: string;
  previousValue: string;
  newValue: string;
  clientName?: string;
  /** True when the change propagated back to a parent project's dueDate. */
  reverseCascaded: boolean;
  /** Structured reverse-cascade info (new in PR #86). `null` when nothing cascaded. */
  reverseCascadeDetail: ReverseCascadeInfo | null;
  /** Audit row id for the `week-field-change` record. */
  auditId?: string;
}

// ── Generic wrapper ─────────────────────────────────────

/**
 * Success variant — `data` is typed per-mutation.
 * Assignable to `OperationResult` (whose `data` is `Record<string, unknown>`).
 */
export interface MutationSuccess<D extends Record<string, unknown> = Record<string, unknown>> {
  ok: true;
  message: string;
  data?: D;
}

/** Failure variant — identical to `OperationResult`'s failure branch. */
export interface MutationFailure {
  ok: false;
  error: string;
  available?: string[];
}

/**
 * Typed discriminated-union response for Runway mutation functions.
 * Every mutation in `operations.ts` returns `MutationResponse<SomeData>`.
 *
 * Structurally assignable to `OperationResult`, so legacy callers that
 * receive the looser type keep compiling without modification.
 */
export type MutationResponse<D extends Record<string, unknown> = Record<string, unknown>> =
  | MutationSuccess<D>
  | MutationFailure;

// Sanity check: `MutationResponse` is assignable to `OperationResult`.
// If someone tightens `OperationResult`, this will surface at build time.
// (Intentionally unused value — type-only assertion.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assignabilityCheck: (r: MutationResponse) => OperationResult = (r) => r;
