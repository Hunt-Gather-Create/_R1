/**
 * Shared insertProposal helper — Builders 3 and 7.
 *
 * Used by:
 *   - `/api/slack/commands` route (Wave 3 / Builder 3) — slash dispatcher
 *     stages a fresh `pending` row before opening the modal so the
 *     view_submission handler can locate the proposal by `private_metadata`.
 *   - bot LLM intercept `interceptCreateForModal` (Wave 7 / Builder 7) — same
 *     contract: stage row + return id, do NOT call `views.open` here. The
 *     bot wrapper appends button blocks that carry the proposalId in
 *     `value` and the open_create_modal action handler consumes the
 *     fresh slash-webhook trigger_id to call views.open.
 *
 * Lifecycle is owned by the Wave 12 expiry sweeper and the
 * view_submission/view_closed handlers — this helper only inserts `pending`
 * rows. It does NOT mutate or delete proposals.
 */

import { eq } from "drizzle-orm";
import { getRunwayDb } from "@/lib/db/runway";
import { botModalProposals } from "@/lib/db/runway-schema";
import { generateId } from "@/lib/runway/operations-utils";

export type ProposalKind = "create" | "edit";
export type ProposalTargetEntityType = "project" | "week_item" | "team_member";

/**
 * Inputs for staging a fresh `bot_modal_proposals` row.
 *
 * - `kind`           - "create" or "edit"; discriminates the row.
 * - `toolName`       - one of: create_project | create_week_item |
 *                       create_team_member | update_project | update_week_item |
 *                       update_team_member.
 * - `args`           - JSON-serializable LLM-extracted args (or current values
 *                       for edit). Stored as a JSON string in the column.
 * - `userSlackId`    - Slack user id who triggered (slash or DM).
 * - `channelId`      - Slack channel where the trigger arrived (DM or channel).
 * - `threadTs`       - Optional parent thread_ts (for threaded DMs).
 * - `targetEntityId` / `targetEntityType` - Set for edit kinds.
 * - `parentProposalId` - Multi-detect chaining: child task -> parent project.
 * - `intentGroupId`  - Groups proposals from one user message.
 * - `pendingProjectName` - Hint for parent-project lookup before parent saved.
 * - `ttlMinutes`     - Default 30. Tunable for tests.
 */
export interface InsertProposalParams {
  kind: ProposalKind;
  toolName: string;
  args: Record<string, unknown>;
  userSlackId: string;
  channelId: string;
  threadTs?: string | null;
  targetEntityId?: string;
  targetEntityType?: ProposalTargetEntityType;
  parentProposalId?: string;
  intentGroupId?: string;
  pendingProjectName?: string;
  conversationRef?: string;
  ttlMinutes?: number;
}

const DEFAULT_TTL_MINUTES = 30;
const PROPOSAL_ID_PREFIX = "prop_";

/**
 * Insert a fresh `pending` proposal row. Returns the generated id so the
 * caller can wire it into the modal `private_metadata` (slash flow) or the
 * Block Kit button `value` (bot intercept flow).
 */
export async function insertProposal(
  params: InsertProposalParams,
): Promise<{ proposalId: string }> {
  const db = getRunwayDb();
  const id = `${PROPOSAL_ID_PREFIX}${generateId()}`;
  const createdAt = new Date();
  const ttlMs =
    (params.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60 * 1000;
  const expiresAt = new Date(createdAt.getTime() + ttlMs);

  await db.insert(botModalProposals).values({
    id,
    userSlackId: params.userSlackId,
    channelId: params.channelId,
    threadTs: params.threadTs ?? null,
    toolName: params.toolName,
    kind: params.kind,
    targetEntityId: params.targetEntityId ?? null,
    targetEntityType: params.targetEntityType ?? null,
    args: JSON.stringify(params.args),
    conversationRef: params.conversationRef ?? null,
    parentProposalId: params.parentProposalId ?? null,
    intentGroupId: params.intentGroupId ?? null,
    pendingProjectName: params.pendingProjectName ?? null,
    postedMessageTs: null,
    postedMessageChannel: null,
    createdAt,
    expiresAt,
    status: "pending",
    statusReason: null,
    resolvedProjectId: null,
  });

  return { proposalId: id };
}

/**
 * Persist the (channel, ts) of the bot's button-bearing reply onto an
 * intercepted proposal row. Carryover #2 from Builder 7's open follow-up:
 * Wave 8's multi-detect chat.update silently no-ops without these columns
 * because it can't locate the original message to edit. Called from `bot.ts`
 * immediately after a successful `chat.postMessage` for intercepted proposals.
 *
 * Errors are propagated to the caller — bot.ts wraps the call so a Turso
 * blip can't crash the response path.
 */
export async function updatePostedMessage(
  proposalId: string,
  ts: string,
  channel: string,
): Promise<void> {
  const db = getRunwayDb();
  await db
    .update(botModalProposals)
    .set({ postedMessageTs: ts, postedMessageChannel: channel })
    .where(eq(botModalProposals.id, proposalId));
}
