/**
 * Wave 8 / Builder 8 - multi-detect chat.update helper.
 *
 * After a parent project view_submission saves successfully, the bot's
 * button-bearing reply (a single message that previously rendered a primary
 * "open project modal" button + 1..N disabled "task - save project first"
 * buttons) needs to be re-emitted with task buttons swapped from
 * `task_button_disabled` to `open_create_modal`.
 *
 * Per pre-plan v7 §B2 (locked):
 *   - Buttons ALWAYS populate `value` with the proposalId from initial render.
 *     `chat.update` only flips action_id (and cosmetic styling); the proposalId
 *     never changes mid-flight.
 *   - Only siblings whose `pendingProjectName` matches the just-saved project
 *     name are eligible to enable. Others stay disabled (they belong to a
 *     different parent that hasn't been saved yet).
 *
 * Failure-mode contract:
 *   - chat.update can fail with `message_not_found`, `cant_update_message`, or
 *     `edit_window_closed` (60-second cap on bot-message edits). On any of
 *     these, fall back to `chat.postMessage` so the user still gets the
 *     enabled buttons.
 *   - If the parent proposal has no `postedMessageTs` (e.g. the bot intercept
 *     hadn't posted a button-bearing reply for some reason), bail gracefully:
 *     resolve sibling DB rows but skip slack calls.
 *   - Slack errors that are not edit-window related still throw to the caller.
 */
import { eq } from "drizzle-orm";
import { botModalProposals } from "@/lib/db/runway-schema";
import type { WebClient } from "@slack/web-api";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/**
 * Loose `db` type - we only need the chained operations the helper uses.
 * Caller passes `getRunwayDb()` (or a test mock with the same chain shape).
 */
export interface MultiDetectDb {
  select: () => {
    from: (table: unknown) => {
      where: (filter: unknown) => Promise<Array<Record<string, unknown>>> & {
        limit?: (n: number) => Promise<Array<Record<string, unknown>>>;
      };
    };
  };
  update: (table: unknown) => {
    set: (patch: Record<string, unknown>) => {
      where: (filter: unknown) => Promise<unknown>;
    };
  };
}

interface ProposalRow {
  id: string;
  toolName: string;
  intentGroupId: string | null;
  parentProposalId: string | null;
  pendingProjectName: string | null;
  postedMessageTs: string | null;
  postedMessageChannel: string | null;
  resolvedProjectId: string | null;
  status: string;
  args: string;
}

// Slack API errors we recognize as "post a fresh follow-up instead of editing".
// `cant_update_message` covers most cases; `message_not_found` fires when the
// bot's original post got deleted; `edit_window_closed` is the 60s cap on
// bot-message edits in some channel types.
const FALLBACK_ERRORS = new Set([
  "message_not_found",
  "cant_update_message",
  "edit_window_closed",
]);

function isFallbackError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { data?: { error?: string }; message?: string };
  if (e.data && typeof e.data.error === "string" && FALLBACK_ERRORS.has(e.data.error)) {
    return true;
  }
  if (typeof e.message === "string") {
    for (const code of FALLBACK_ERRORS) {
      if (e.message.includes(code)) return true;
    }
  }
  return false;
}

// ----------------------------------------------------------------------------
// Block-emit helper
// ----------------------------------------------------------------------------

/**
 * Build the actions block for the re-emitted message. Each sibling renders
 * one button. The action_id is `open_create_modal` for siblings now resolved
 * (resolvedProjectId set), `task_button_disabled` for those still pending.
 * The button `value` is always the proposalId, per §B2.
 */
function buildActionsBlock(siblings: ProposalRow[]): Record<string, unknown> {
  const elements = siblings.map((s) => {
    const enabled = !!s.resolvedProjectId;
    const text = labelForSibling(s, enabled);
    const button: Record<string, unknown> = {
      type: "button",
      action_id: enabled ? "open_create_modal" : "task_button_disabled",
      text: { type: "plain_text", text, emoji: true },
      value: s.id,
    };
    if (enabled) button.style = "primary";
    return button;
  });
  return {
    type: "actions",
    block_id: "multi_detect_actions",
    elements,
  };
}

function labelForSibling(s: ProposalRow, enabled: boolean): string {
  // Toolname tells us if it's a project (the parent itself) or a task. The
  // parent button always renders enabled.
  const isProject = s.toolName === "create_project";
  if (isProject) {
    return enabled ? "Project (saved)" : "Project: open form";
  }
  // Tasks: try to derive a name from args.title for nicer copy. Fall back to
  // generic copy if args is missing or unparseable - the proposalId still
  // routes correctly via `value`.
  let title = "Task";
  try {
    const parsed = JSON.parse(s.args ?? "{}") as Record<string, unknown>;
    if (typeof parsed.title === "string" && parsed.title.length > 0) {
      title = `Task: ${parsed.title}`;
    }
  } catch {
    // ignore
  }
  return enabled ? title : `${title} - save project first`;
}

function buildHeaderBlock(savedAny: boolean): Record<string, unknown> {
  const text = savedAny
    ? "Got it - I caught a few items. Project saved - tasks are now enabled."
    : "Got it - I caught a few items. Click each below to review and save.";
  return {
    type: "section",
    block_id: "multi_detect_header",
    text: { type: "mrkdwn", text },
  };
}

// ----------------------------------------------------------------------------
// Public helper
// ----------------------------------------------------------------------------

/**
 * Re-emit the bot's button-bearing message after the parent project save
 * resolves. See module-level comment for the §B2 contract.
 *
 * @param parentProposalId  The proposalId for the project row that just saved.
 * @param resolvedProjectId The new projects.id row id from the save.
 * @param savedProjectName  The project name that was saved - used to match
 *                          siblings whose pendingProjectName equals this.
 * @param slack             A Slack WebClient (or test mock).
 * @param db                The runway db handle (or test mock).
 */
export async function reEmitButtonsAfterParentSave(
  parentProposalId: string,
  resolvedProjectId: string,
  savedProjectName: string,
  slack: WebClient,
  db: MultiDetectDb,
): Promise<void> {
  // 1. Look up the parent proposal.
  const parentRows = (await db
    .select()
    .from(botModalProposals)
    .where(eq(botModalProposals.id, parentProposalId))) as unknown as ProposalRow[];
  const parent = parentRows[0];
  if (!parent) return;

  const intentGroupId = parent.intentGroupId;
  if (!intentGroupId) {
    // Single-detect (no group). No siblings to scan; nothing to do here.
    return;
  }

  // 2. Pull all siblings (incl. parent itself) sharing the intent group.
  const siblings = (await db
    .select()
    .from(botModalProposals)
    .where(eq(botModalProposals.intentGroupId, intentGroupId))) as unknown as ProposalRow[];

  // 3. Mark eligible siblings resolved. Eligibility: pendingProjectName
  //    matches the just-saved project name (case-insensitive trim) AND the
  //    sibling is still pending (not already submitted/cancelled/expired).
  const target = savedProjectName.trim().toLowerCase();
  const updatedSiblings: ProposalRow[] = [];
  for (const s of siblings) {
    const isEligible =
      s.id !== parentProposalId &&
      s.status === "pending" &&
      !s.resolvedProjectId &&
      typeof s.pendingProjectName === "string" &&
      s.pendingProjectName.trim().toLowerCase() === target;
    if (isEligible) {
      await db
        .update(botModalProposals)
        .set({ resolvedProjectId })
        .where(eq(botModalProposals.id, s.id));
      updatedSiblings.push({ ...s, resolvedProjectId });
    } else {
      updatedSiblings.push(s);
    }
  }

  // 4. Bail gracefully if the parent message location wasn't recorded - we
  //    have no message to update or thread to follow up in.
  if (!parent.postedMessageTs || !parent.postedMessageChannel) return;

  // 5. Build the re-emit blocks. Parent first (matches initial render order),
  //    then siblings sorted by id for stable button order.
  const parentSelf: ProposalRow = {
    ...parent,
    resolvedProjectId: parent.resolvedProjectId ?? resolvedProjectId,
  };
  const taskSiblings = updatedSiblings
    .filter((s) => s.id !== parentProposalId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const orderedForButtons = [parentSelf, ...taskSiblings];

  const blocks = [
    buildHeaderBlock(true),
    buildActionsBlock(orderedForButtons),
  ];
  const text =
    "Got it - I caught a few items. Project saved - tasks are now enabled.";

  // 6. Try chat.update first; fall back to chat.postMessage on edit-window
  //    errors. Re-throw anything else - the caller's Inngest function will
  //    surface the failure to the user via the standard error path.
  try {
    await slack.chat.update({
      channel: parent.postedMessageChannel,
      ts: parent.postedMessageTs,
      text,
      blocks: blocks as never,
    });
  } catch (err) {
    if (!isFallbackError(err)) throw err;
    await slack.chat.postMessage({
      channel: parent.postedMessageChannel,
      thread_ts: parent.postedMessageTs,
      text,
      blocks: blocks as never,
    });
  }
}
