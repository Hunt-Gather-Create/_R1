/**
 * Wave 7 / Builder 7 — bot LLM intercept helper.
 *
 * Per Spike C resolution + pre-plan v7 §"Bot LLM intercept hook (Pattern A)":
 * the bot's `generateText` loop calls `interceptCreateForModal()` from each
 * modal-routed `create_*` tool's `execute()` callback. The helper:
 *
 *   1. Step-aware flag check on `convoState`. Allow N parallel calls in the
 *      SAME step (multi-detect). Reject calls in any subsequent step.
 *   2. Insert proposal row via the shared `insertProposal()` helper. Carries
 *      `intent_group_id`, optional `pendingProjectName`, optional
 *      `parentProposalId` (set later by the caller for child task chaining).
 *   3. Set `convoState.modalAlreadyOpened = true` and record the step index.
 *   4. Return `{ modalOpened, proposalId, kind, title, parentProjectName? }`
 *      to the LLM. **Does NOT call `views.open`** — Slack does not provide a
 *      `trigger_id` on message events. The bot wrapper composes a Block Kit
 *      button-bearing reply; user clicks the button and the resulting
 *      block_actions payload to /api/slack/interactivity carries a fresh
 *      `trigger_id` to open the modal.
 *
 * Termination is the joint responsibility of:
 *   - `stopOnModalOpened` custom `stopWhen` predicate (Strategy 1) — wired in
 *     bot.ts alongside `stepCountIs(MAX_STEPS)`.
 *   - the step-aware flag (Strategy 2) — defends against parallel-step LLM
 *     misbehavior even if Strategy 1 fails to fire.
 *   - system prompt belt (Strategy 3, defensive) — bot-context-behaviors.ts.
 *
 * `composeButtonBearingReply()` is the post-loop helper used by bot.ts to
 * build the chat.postMessage body when one or more proposals were
 * intercepted. Single-button case uses BOT_SINGLE_INTERCEPT_REPLY; multi-detect
 * uses formatBotMultiDetectReply(N) and renders one Block Kit button per
 * proposal (project first, tasks after with a disabled state when their
 * parent project is staged but not yet saved).
 */

import type { StopCondition } from "ai";
import { isModalInterceptEnabled } from "@/lib/feature-flags";
import { insertProposal } from "./proposal";
import { BOT_SINGLE_INTERCEPT_REPLY, formatBotMultiDetectReply } from "./copy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InterceptToolName =
  | "create_project"
  | "create_week_item"
  | "create_team_member";

export type InterceptKind = "project" | "task" | "team_member" | "retainer";

/**
 * Per-conversation state threaded through `createBotTools`. The bot wrapper
 * resets this once per `handleDirectMessage` invocation. `currentStep` is
 * updated by the `prepareStep` callback wired into `generateText` so the
 * intercept can record the step index where the modal opened.
 */
export interface ConvoState {
  modalAlreadyOpened: boolean;
  openStep: number | null;
  /**
   * Most recent step number observed from `prepareStep`. Used by the
   * step-aware flag check to allow parallel calls in the same step but
   * reject any call in a subsequent step.
   */
  currentStep: number;
}

export interface InterceptContext {
  slackUserId: string;
  channelId: string;
  threadTs: string | null;
  /**
   * One id per user message. Bot wrapper generates this once per
   * `handleDirectMessage` call and threads it through. Multi-detect
   * proposals share it; the multi-detect chat.update on parent submit reads
   * by intent_group_id to find sibling task proposals.
   */
  intentGroupId: string;
}

export interface InterceptResult {
  modalOpened: true;
  proposalId: string;
  kind: InterceptKind;
  title: string;
  /** Set when the proposal was staged with a `pendingProjectName` hint
   *  (multi-detect child task whose parent project hasn't been saved yet). */
  parentProjectName?: string;
}

export interface InterceptError {
  error: string;
}

export interface InterceptParams {
  toolName: InterceptToolName;
  args: Record<string, unknown>;
  context: InterceptContext;
  convoState: ConvoState;
}

// ---------------------------------------------------------------------------
// interceptCreateForModal
// ---------------------------------------------------------------------------

/**
 * Stage a `bot_modal_proposals` row and return the modalOpened signal.
 * Step-aware against `convoState`. Defensive against the feature flag being
 * off (bot-tools wrapper checks the flag too; this is belt-and-suspenders).
 */
export async function interceptCreateForModal(
  params: InterceptParams,
): Promise<InterceptResult | InterceptError> {
  if (!isModalInterceptEnabled()) {
    // The bot-tools wrapper should already have routed to the legacy direct
    // write path before reaching us. If it didn't, fail loud rather than
    // silently dropping the intercept.
    return { error: "Modal intercept is disabled (MODAL_INTERCEPT_ENABLED != true)." };
  }

  const { convoState, context } = params;

  // Step-aware flag: same step -> allow (parallel multi-detect tool calls
  // in step 0 all execute before stopWhen fires). Different step -> reject.
  if (
    convoState.modalAlreadyOpened &&
    convoState.openStep !== null &&
    convoState.openStep !== convoState.currentStep
  ) {
    return {
      error:
        "A form is already open. Have the user submit or cancel it first.",
    };
  }

  const kind = mapToolToKind(params.toolName, params.args);
  const title = extractTitle(params.toolName, params.args);
  const parentProjectName =
    typeof params.args.pendingProjectName === "string"
      ? params.args.pendingProjectName
      : undefined;

  const { proposalId } = await insertProposal({
    kind: "create",
    toolName: params.toolName,
    args: params.args,
    userSlackId: context.slackUserId,
    channelId: context.channelId,
    threadTs: context.threadTs ?? null,
    intentGroupId: context.intentGroupId,
    pendingProjectName: parentProjectName,
  });

  // Mark the convo state. Parallel calls in the same step all set the same
  // openStep; the predicate above lets them through.
  if (!convoState.modalAlreadyOpened) {
    convoState.modalAlreadyOpened = true;
    convoState.openStep = convoState.currentStep;
  }

  const result: InterceptResult = {
    modalOpened: true,
    proposalId,
    kind,
    title,
  };
  if (parentProjectName) {
    result.parentProjectName = parentProjectName;
  }
  return result;
}

// ---------------------------------------------------------------------------
// stopOnModalOpened — custom `stopWhen` predicate
// ---------------------------------------------------------------------------

/**
 * Returns `true` when any toolResult in the latest step has
 * `output.modalOpened === true`. Pairs with `stepCountIs(MAX_STEPS)` in
 * bot.ts as `stopWhen: [stepCountIs(MAX_STEPS), stopOnModalOpened]`.
 *
 * Per Spike C, this saves one Anthropic API roundtrip (~1-2s p50,
 * ~2.5s p95) by terminating the loop before the LLM is re-invoked with the
 * tool result. `result.text` will be `""` when this fires; the bot wrapper
 * composes the user-facing reply itself via `composeButtonBearingReply`.
 */
export const stopOnModalOpened: StopCondition<Record<string, never>> = ({
  steps,
}) => {
  const last = steps.at(-1);
  const results = last?.toolResults ?? [];
  return results.some(
    (r) =>
      (r as { output?: { modalOpened?: boolean } }).output?.modalOpened === true,
  );
};

// ---------------------------------------------------------------------------
// extractInterceptedProposals
// ---------------------------------------------------------------------------

interface StepLike {
  toolResults?: Array<{
    toolName?: string;
    output?: unknown;
  }>;
}

/**
 * Walk the result of `generateText` and collect every InterceptResult that
 * came back from a modal-routed tool. Per Spike C, AI SDK v6 places parallel
 * tool calls in the same step, and `stopOnModalOpened` halts the loop after
 * the first step with a modalOpened result, so the proposals always land in
 * step 0. We still iterate every step to be robust against future SDK
 * behavior changes.
 */
export function extractInterceptedProposals(result: {
  steps: StepLike[];
}): InterceptResult[] {
  const out: InterceptResult[] = [];
  for (const step of result.steps) {
    if (!step.toolResults) continue;
    for (const r of step.toolResults) {
      const output = r.output as Partial<InterceptResult> | undefined;
      if (output && output.modalOpened === true && typeof output.proposalId === "string") {
        out.push({
          modalOpened: true,
          proposalId: output.proposalId,
          kind: output.kind as InterceptKind,
          title: output.title ?? "(untitled)",
          ...(output.parentProjectName ? { parentProjectName: output.parentProjectName } : {}),
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// composeButtonBearingReply
// ---------------------------------------------------------------------------

interface ButtonElement {
  type: "button";
  text: { type: "plain_text"; text: string; emoji: true };
  action_id: string;
  value: string;
  style?: "primary" | "danger";
}

interface SectionBlock {
  type: "section";
  text: { type: "mrkdwn"; text: string };
}

interface ActionsBlock {
  type: "actions";
  elements: ButtonElement[];
}

export type ReplyBlock = SectionBlock | ActionsBlock;

export interface BotReply {
  text: string;
  blocks: ReplyBlock[];
}

/**
 * Build a `chat.postMessage` payload for one or more intercepted proposals.
 *
 * - Single intercept: top-level text = BOT_SINGLE_INTERCEPT_REPLY; one
 *   button labelled by kind + title with action_id="open_create_modal".
 * - Multi intercept: top-level text = formatBotMultiDetectReply(N); one
 *   button per proposal. Project / retainer proposals sort before tasks.
 *   When a project is staged in the same batch and a task carries a
 *   `parentProjectName`, the task button surfaces in `danger` style with
 *   `action_id="task_button_disabled"` — Wave 8's interactivity handler
 *   responds with the TASK_BUTTON_DISABLED ephemeral. Once the project
 *   submits, Wave 8's chat.update flow re-emits the buttons with
 *   `action_id="open_create_modal"` and the resolved projectId in `value`.
 * - Mixed read+create: when the LLM also produced text alongside intercepts
 *   (single-step parallel: read tool result + create_* result), `replyText`
 *   is non-empty. We prepend it as a section block so the user sees both
 *   the answer and the form button in ONE message (no double-post).
 */
export function composeButtonBearingReply(
  intercepted: InterceptResult[],
  replyText: string,
): BotReply {
  const blocks: ReplyBlock[] = [];

  // 1. LLM text (mixed read+create) prepended.
  if (replyText.trim().length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: replyText },
    });
  }

  // 2. Bot intro (single vs multi).
  const introText =
    intercepted.length === 1
      ? BOT_SINGLE_INTERCEPT_REPLY
      : formatBotMultiDetectReply(intercepted.length);
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: introText },
  });

  // 3. One button per intercepted proposal.
  // Sort: project / retainer first, tasks after. Stable within each group.
  const sorted = [...intercepted].sort((a, b) => kindRank(a.kind) - kindRank(b.kind));

  // Determine: does this batch have a project / retainer? If yes, every task
  // whose `parentProjectName` is set surfaces as disabled.
  const projectInBatch = intercepted.some(
    (r) => r.kind === "project" || r.kind === "retainer",
  );

  const buttons: ButtonElement[] = sorted.map((r) => buildButton(r, projectInBatch));
  blocks.push({ type: "actions", elements: buttons });

  // Top-level `text` field: combined for accessibility / push-notification
  // fallback. Slack uses it when blocks render fails.
  const fallback = replyText.trim().length > 0 ? `${replyText}\n\n${introText}` : introText;

  return { text: fallback, blocks };
}

function buildButton(
  r: InterceptResult,
  projectInBatch: boolean,
): ButtonElement {
  const isTaskWithStagedParent =
    r.kind === "task" && projectInBatch && !!r.parentProjectName;

  const label = formatButtonLabel(r.kind, r.title);
  const actionId = isTaskWithStagedParent ? "task_button_disabled" : "open_create_modal";
  const button: ButtonElement = {
    type: "button",
    text: { type: "plain_text", text: label, emoji: true },
    action_id: actionId,
    value: r.proposalId,
  };
  if (r.kind === "project" || r.kind === "retainer") {
    button.style = "primary";
  } else if (isTaskWithStagedParent) {
    button.style = "danger";
  }
  return button;
}

const KIND_LABEL: Record<InterceptKind, string> = {
  project: "Project",
  retainer: "Retainer",
  task: "Task",
  team_member: "Team Member",
};

// Slack button text is hard-capped at 75 chars; truncate the title side
// while preserving the kind prefix.
const BUTTON_TEXT_LIMIT = 70;

function formatButtonLabel(kind: InterceptKind, title: string): string {
  const prefix = `${KIND_LABEL[kind]}: `;
  const room = BUTTON_TEXT_LIMIT - prefix.length;
  if (title.length <= room) return `${prefix}${title}`;
  return `${prefix}${title.slice(0, room - 1)}…`;
}

function kindRank(kind: InterceptKind): number {
  if (kind === "project" || kind === "retainer") return 0;
  if (kind === "team_member") return 1;
  return 2; // task
}

// ---------------------------------------------------------------------------
// Internal mappers
// ---------------------------------------------------------------------------

function mapToolToKind(
  toolName: InterceptToolName,
  args: Record<string, unknown>,
): InterceptKind {
  if (toolName === "create_project") {
    return args.isRetainer === true || args.engagementType === "retainer"
      ? "retainer"
      : "project";
  }
  if (toolName === "create_week_item") return "task";
  if (toolName === "create_team_member") return "team_member";
  // Unreachable: TypeScript narrows the union, but defensive default.
  throw new Error(`Unknown intercept tool: ${toolName as string}`);
}

function extractTitle(
  toolName: InterceptToolName,
  args: Record<string, unknown>,
): string {
  if (toolName === "create_project") {
    return typeof args.name === "string" && args.name.length > 0
      ? args.name
      : "(untitled)";
  }
  if (toolName === "create_week_item") {
    return typeof args.title === "string" && args.title.length > 0
      ? args.title
      : "(untitled)";
  }
  if (toolName === "create_team_member") {
    if (typeof args.fullName === "string" && args.fullName.length > 0) {
      return args.fullName;
    }
    if (typeof args.name === "string" && args.name.length > 0) {
      return args.name;
    }
    return "(untitled)";
  }
  return "(untitled)";
}
