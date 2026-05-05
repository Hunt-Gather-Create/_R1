/**
 * Slack interactivity webhook handler.
 *
 * POST /api/slack/interactivity
 *
 * Accepts every Slack interactive payload type:
 *   - block_actions      (button clicks, checkbox toggles, picker changes)
 *   - view_submission    (modal "Save" submit)
 *   - view_closed        (modal cancel / dismiss with notify_on_close=true)
 *   - shortcut           (global / message shortcuts - currently unused)
 *
 * Security mirrors `/api/slack/events`:
 *   - HMAC-SHA256 signature verification on every request via
 *     `verifySlackSignature` (5-minute replay window enforced inside).
 *   - Tampered or stale requests -> 401.
 *   - Misconfigured server (no `SLACK_SIGNING_SECRET`) -> 400 per pre-plan v7.
 *
 * Body shape: Slack sends interactive payloads as
 * `application/x-www-form-urlencoded` with a single `payload=<json>` field -
 * NOT plain JSON like the Events API. We parse the URLSearchParams and
 * `JSON.parse` the `payload` value before routing.
 *
 * Routing strategy: dispatch on `payload.type`, then drill in by
 * `actions[0].action_id` (block_actions) or `view.callback_id`
 * (view_submission/view_closed).
 *
 * Wave 8 (Builder 8) wires the live action/callback handlers below.
 * Wave 11 (Builder 11) wires view_closed - dismiss flips proposal to
 * cancelled + posts a Civ-voice thread reply. The NotImplementedError class
 * stays exported as a sentinel for future not-yet-wired branches.
 */

import { eq } from "drizzle-orm";
import { verifySlackSignature } from "@/lib/slack/verify";
import { getSlackClient } from "@/lib/slack/client";
import { getRunwayDb } from "@/lib/db/runway";
import { botModalProposals } from "@/lib/db/runway-schema";
import { fuzzyMatchCandidates } from "@/lib/runway/fuzzy-match";
import {
  BASELINE_PARENT_PICKER_HINT,
  CONCURRENT_PROPOSAL_SOFT_WARN,
  MODAL_CANCELLED_THREAD_REPLY,
  MODAL_SAVE_IN_FLIGHT,
  formatEditMultiMatchHint,
  formatMultiMatchHint,
  PARENT_PROJECT_NOT_FOUND,
  TASK_BUTTON_DISABLED,
} from "@/lib/slack/modals/copy";
import { buildTaskModal } from "@/lib/slack/modals/task";
import {
  buildProjectModal,
  buildEphemeralRetainerToggle,
  type BlockActionsPayload,
} from "@/lib/slack/modals/project";
import { buildTeamMemberModal } from "@/lib/slack/modals/team-member";
import { getProjectsFiltered } from "@/lib/runway/operations-reads-clients";
import {
  getClientNameById,
  getProjectsForClient,
} from "@/lib/runway/operations-utils";
import { inngest } from "@/lib/inngest/client";
import { checkConcurrentProposal } from "@/lib/slack/modals/concurrency-check";
import { recordProposalLifecycleTransition } from "@/lib/slack/modals/observability";
import { loadEntityById } from "@/lib/slack/load-entity-by-id";
import { inferDateTypeFromArgs } from "@/lib/slack/modals/validate-submission";

// -----------------------------------------------------------------------------
// Payload types - discriminated union, just enough for type-safe dispatch.
// -----------------------------------------------------------------------------

/** Single action element inside a block_actions payload's `actions` array. */
interface SlackAction {
  action_id?: string;
  block_id?: string;
  type?: string;
  value?: string;
  selected_option?: { value?: string };
  selected_options?: Array<{ value?: string }>;
  // Slack adds many other fields per action type; carry them through opaquely.
  [key: string]: unknown;
}

interface SlackBlockActionsPayload {
  type: "block_actions";
  user?: { id?: string; team_id?: string };
  team?: { id?: string };
  trigger_id?: string;
  response_url?: string | null;
  view?: SlackView;
  channel?: { id?: string } | null;
  channel_id?: string | null;
  actions?: SlackAction[];
  [key: string]: unknown;
}

/** A Slack modal view as it appears inside view_submission/view_closed. */
interface SlackView {
  id?: string;
  hash?: string;
  callback_id?: string;
  private_metadata?: string;
  state?: { values?: Record<string, unknown> };
  [key: string]: unknown;
}

interface SlackViewSubmissionPayload {
  type: "view_submission";
  user?: { id?: string };
  team?: { id?: string };
  trigger_id?: string;
  view?: SlackView;
  [key: string]: unknown;
}

interface SlackViewClosedPayload {
  type: "view_closed";
  user?: { id?: string };
  team?: { id?: string };
  view?: SlackView;
  is_cleared?: boolean;
  [key: string]: unknown;
}

interface SlackShortcutPayload {
  type: "shortcut";
  callback_id?: string;
  user?: { id?: string };
  team?: { id?: string };
  trigger_id?: string;
  [key: string]: unknown;
}

export type SlackInteractionPayload =
  | SlackBlockActionsPayload
  | SlackViewSubmissionPayload
  | SlackViewClosedPayload
  | SlackShortcutPayload;

// -----------------------------------------------------------------------------
// Sentinel error - kept for view_closed (Wave 11 wires it). Tests assert on
// the class so subsequent edits don't break the dispatch contract.
// -----------------------------------------------------------------------------

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

// -----------------------------------------------------------------------------
// Schema-truth callback id list. Keeps the inngest event's modalCallbackId
// field strongly typed without re-declaring the union here.
// -----------------------------------------------------------------------------
const VIEW_SUBMISSION_CALLBACKS = [
  "runway_new_task",
  "runway_new_project",
  "runway_new_team_member",
  "runway_edit_task",
  "runway_edit_project",
  "runway_edit_team_member",
] as const;
type ModalCallbackId = (typeof VIEW_SUBMISSION_CALLBACKS)[number];

function isModalCallbackId(v: string | undefined): v is ModalCallbackId {
  return typeof v === "string" && (VIEW_SUBMISSION_CALLBACKS as readonly string[]).includes(v);
}

// -----------------------------------------------------------------------------
// Route handler
// -----------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // Read the raw body BEFORE any parsing - HMAC is computed over the exact
  // bytes Slack sent, including URL-encoding.
  const rawBody = await request.text();

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const signature = request.headers.get("x-slack-signature");
  const timestamp = request.headers.get("x-slack-request-timestamp");

  if (!signingSecret || !signature || !timestamp) {
    return new Response("Bad Request", { status: 400 });
  }

  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    return new Response("Unauthorized", { status: 401 });
  }

  // URL-decode the form body and pull the single `payload` field.
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return new Response("Bad Request", { status: 400 });
  }

  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(payloadStr) as SlackInteractionPayload;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  switch (payload.type) {
    case "block_actions":
      return await handleBlockActions(payload);
    case "view_submission":
      return await handleViewSubmission(payload);
    case "view_closed":
      return await handleViewClosed(payload);
    case "shortcut":
      return await handleShortcut(payload);
    default:
      return new Response("Bad Request", { status: 400 });
  }
}

// -----------------------------------------------------------------------------
// block_actions dispatch
// -----------------------------------------------------------------------------

async function handleBlockActions(
  payload: SlackBlockActionsPayload,
): Promise<Response> {
  const action = payload.actions?.[0];
  const actionId = action?.action_id;

  switch (actionId) {
    case "open_create_modal":
      return await handleOpenCreateModal(payload, action!);
    case "is_retainer_checkbox":
      return await handleRetainerToggle(payload);
    case "task_button_disabled":
      return await handleTaskButtonDisabled(payload, action!);
    case "date_type_radio":
      return await handleDateTypeToggle(payload, action!);
    case "client_select":
      return await handleClientSelectCascade(payload, action!);
    case "multi_match_candidate_select":
      return await handleMultiMatchCandidateSelect(payload, action!);
    default:
      // Repeater rows, in-modal pickers without `dispatch_action`, and any
      // action_id we don't explicitly handle on the server are no-ops here:
      // Slack handles the visual state client-side, and we ack with 200 so
      // Slack doesn't show the "didn't work" warning to the user.
      return new Response("OK", { status: 200 });
  }
}

// -----------------------------------------------------------------------------
// open_create_modal - the primary "open the form" button on a bot intercept
// or slash-command stub. Loads the staged proposal, runs caller-side fuzzy
// match for parent-picker hints, then opens the right modal via views.open.
// trigger_id has 3-second validity from Slack: we keep the path tight (one
// DB roundtrip + at most one fuzzy lookup before views.open).
// -----------------------------------------------------------------------------

async function handleOpenCreateModal(
  payload: SlackBlockActionsPayload,
  action: SlackAction,
): Promise<Response> {
  const proposalId = action.value;
  const triggerId = payload.trigger_id;
  const channelId = payload.channel?.id ?? payload.channel_id ?? undefined;

  if (!proposalId || typeof proposalId !== "string") {
    return new Response("OK", { status: 200 });
  }

  const proposal = await loadProposal(proposalId);
  if (!proposal) {
    await tryPostEphemeral(channelId, payload.user?.id, "I couldn't find that draft - it may have expired. Try the slash command again.");
    return new Response("OK", { status: 200 });
  }

  // Validate proposal lifecycle.
  const now = Date.now();
  const expiresAtMs =
    proposal.expiresAt instanceof Date
      ? proposal.expiresAt.getTime()
      : new Date(proposal.expiresAt as unknown as string).getTime();
  if (proposal.status === "submitted") {
    await tryPostEphemeral(channelId, payload.user?.id, "That draft was already submitted.");
    return new Response("OK", { status: 200 });
  }
  if (proposal.status === "cancelled") {
    await tryPostEphemeral(channelId, payload.user?.id, "That draft was cancelled. Start fresh with the slash command.");
    return new Response("OK", { status: 200 });
  }
  if (proposal.status === "expired" || expiresAtMs <= now) {
    await tryPostEphemeral(channelId, payload.user?.id, "That draft expired. Try the slash command again.");
    return new Response("OK", { status: 200 });
  }

  // Parse args.
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(proposal.args ?? "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }

  const toolName = proposal.toolName;
  const kind = toolKind(toolName);

  // For Project tool with isRetainer=true, retainerMode wins and BOTH hints
  // are suppressed regardless of caller-side fuzzy match.
  const isRetainerProject =
    kind === "project" && (args.isRetainer === true || args.isRetainer === "true");

  // Caller-side fuzzy match for parent-picker hints. Only fires for create
  // flows that have a parent name AND a parent picker (Task, non-retainer
  // Project). Team Member has no parent picker. Edit flows don't trigger
  // this branch - they use the slash-command lookup, which Builder 3 owns.
  // Per Builder 8 spec: when parent name is absent (bot intercept didn't
  // extract one) OR retainer-mode Project, BOTH hints stay undefined so the
  // user gets a clean picker without nudge copy that has no referent.
  let multiMatchHint: string | undefined;
  let baselineHint: string | undefined;
  if (proposal.kind === "create" && !isRetainerProject) {
    if (kind === "task" || kind === "project") {
      const parentName =
        kind === "task"
          ? (args.parentProjectName as string | undefined)
          : (args.parentRetainerName as string | undefined);
      if (typeof parentName === "string" && parentName.trim().length > 0) {
        baselineHint = BASELINE_PARENT_PICKER_HINT;
        const clientSlug = (args.clientSlug as string | undefined) ?? undefined;
        const candidates = await getProjectsFiltered(
          clientSlug ? { clientSlug } : undefined,
        );
        const matches = fuzzyMatchCandidates(
          parentName,
          (candidates ?? []) as Array<{ name?: string }>,
          (c) => (typeof c.name === "string" ? c.name : ""),
        );
        if (matches.length > 1) {
          const copyKind = kind === "task" ? "project" : "retainer";
          multiMatchHint = formatMultiMatchHint(matches.length, parentName, copyKind);
        }
      }
    }
  }

  // Wave 11 / Builder 11 - concurrency soft-warn. When another user opens a
  // similar create form in the same channel within the last 60s, prepend a
  // soft-warn into multiMatchHint (the existing rendering surface). Gated on
  // create flows only - edit flows have their own disambiguation path.
  if (proposal.kind === "create") {
    const fuzzyTitle = extractTitleForFuzzy(toolName, args);
    if (fuzzyTitle.length > 0) {
      const concurrent = await checkConcurrentProposal({
        toolName,
        fuzzyTitle,
        currentUserSlackId: proposal.userSlackId,
        currentChannelId: proposal.channelId,
      });
      if (concurrent.hasConcurrent) {
        const warn = CONCURRENT_PROPOSAL_SOFT_WARN(
          concurrent.otherUser,
          concurrent.otherTitle,
        );
        multiMatchHint =
          multiMatchHint && multiMatchHint.length > 0
            ? `${warn}\n${multiMatchHint}`
            : warn;
      }
    }
  }

  // Build the right view for this kind.
  const view = buildViewForOpen({
    kind,
    mode: proposal.kind,
    proposalId: proposal.id,
    args,
    retainerMode: !!isRetainerProject,
    multiMatchHint,
    baselineHint,
    currentValues: proposal.kind === "edit" ? args : undefined,
  });

  if (!view) return new Response("OK", { status: 200 });
  if (!triggerId) return new Response("OK", { status: 200 });

  try {
    await getSlackClient().views.open({ trigger_id: triggerId, view: view as never });
  } catch (err) {
    // views.open failure typically means trigger_id expired (>3s) or the modal
    // shape is malformed. Surface a soft-warn ephemeral so the user knows to
    // retry rather than staring at a silent failure.
    console.error("[slack-interactivity] views.open failed", err);
    await tryPostEphemeral(channelId, payload.user?.id, "I couldn't open that form. Try the slash command again.");
  }
  return new Response("OK", { status: 200 });
}

// -----------------------------------------------------------------------------
// is_retainer_checkbox - flip the project modal between project and retainer
// variants while preserving user-typed values. Builder 5 exported the helper.
//
// Slack does not honor response_action: "update" on a block_actions payload -
// that response shape is only valid for view_submission. For block_actions
// from inside a modal, Slack expects an empty 200 ack and a separate
// views.update API call. Mirror the date_type_radio + client_select cascade
// pattern so the rebuild actually reaches the user's UI.
// -----------------------------------------------------------------------------

async function handleRetainerToggle(
  payload: SlackBlockActionsPayload,
): Promise<Response> {
  const view = payload.view;
  if (!view?.id) {
    return new Response("OK", { status: 200 });
  }

  const responseAction = buildEphemeralRetainerToggle(payload as BlockActionsPayload);

  try {
    await getSlackClient().views.update({
      view_id: view.id,
      hash: typeof view.hash === "string" ? view.hash : undefined,
      view: responseAction.view as never,
    } as Parameters<ReturnType<typeof getSlackClient>["views"]["update"]>[0]);
  } catch (err) {
    // hash_conflict races are acceptable - Slack will sync on the next
    // interaction. Log for visibility but don't fail the handler.
    console.error("[slack-interactivity] retainer toggle views.update failed", err);
  }

  return new Response("OK", { status: 200 });
}

// -----------------------------------------------------------------------------
// task_button_disabled - clicked while the parent project hasn't saved yet.
// Surface the locked TASK_BUTTON_DISABLED ephemeral. If the row is already
// resolved, the multi-detect helper should have swapped action_id back to
// open_create_modal - log a warn but don't error.
// -----------------------------------------------------------------------------

async function handleTaskButtonDisabled(
  payload: SlackBlockActionsPayload,
  action: SlackAction,
): Promise<Response> {
  const proposalId = action.value;
  const channelId = payload.channel?.id ?? payload.channel_id ?? undefined;
  if (!proposalId || typeof proposalId !== "string") {
    return new Response("OK", { status: 200 });
  }
  const proposal = await loadProposal(proposalId);
  if (!proposal) {
    return new Response("OK", { status: 200 });
  }
  if (!proposal.resolvedProjectId) {
    await tryPostEphemeral(channelId, payload.user?.id, TASK_BUTTON_DISABLED);
    return new Response("OK", { status: 200 });
  }
  // Defensive branch: chat.update should have re-emitted with action_id =
  // open_create_modal once the parent saved. Reaching this point means the
  // user clicked an old/cached version of the button. Log + ack.
  console.warn(
    "[slack-interactivity] task_button_disabled clicked on resolved proposal",
    { proposalId, resolvedProjectId: proposal.resolvedProjectId },
  );
  // Surface PARENT_PROJECT_NOT_FOUND only if the proposal is genuinely lost;
  // here we just ack since the proposal is resolved.
  void PARENT_PROJECT_NOT_FOUND;
  return new Response("OK", { status: 200 });
}

// -----------------------------------------------------------------------------
// date_type_radio - Single vs Range toggle. Slack has no native conditional
// visibility, so we re-render the view via views.update with the new mode.
// Single mode shows one date picker; Range mode shows start + end pickers.
// All other already-typed/picked field values are preserved by reading
// view.state.values into a fresh currentValues snapshot before rebuild.
// -----------------------------------------------------------------------------

async function handleDateTypeToggle(
  payload: SlackBlockActionsPayload,
  action: SlackAction,
): Promise<Response> {
  const view = payload.view;
  if (!view?.id) {
    return new Response("OK", { status: 200 });
  }

  // Only Task modal renders a date_type_radio today. If callback_id ever
  // surfaces another mode, route it here. For now bail on non-task callers.
  const callbackId = view.callback_id;
  if (
    callbackId !== "runway_new_task" &&
    callbackId !== "runway_edit_task"
  ) {
    return new Response("OK", { status: 200 });
  }

  const meta = parsePrivateMetadata(view.private_metadata);
  const proposalId = meta.proposalId;
  if (!proposalId) {
    return new Response("OK", { status: 200 });
  }

  const newDateType =
    action.selected_option?.value === "range" ? "range" : "single";

  const proposal = await loadProposal(proposalId);
  if (!proposal) {
    return new Response("OK", { status: 200 });
  }

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(proposal.args ?? "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }

  const stateValues = isStateValuesShape(view.state?.values)
    ? view.state.values
    : {};
  const preserved = extractTaskCurrentValuesFromState(stateValues);
  const currentValues: Record<string, unknown> = {
    ...args,
    ...preserved,
    dateType: newDateType,
  };

  // Drop stale date initials when the toggle changes the dateType. Slack's
  // datepicker reports `initial_date` as `selected_date` on view_submission
  // even when the user never opened the picker, so carrying the prior mode's
  // mirrored dates forward (e.g. Single's date == startDate == endDate)
  // would silently re-submit those values under the new mode and trip the
  // start <= end write-time guard. Render the new mode's pickers empty so
  // the user must explicitly commit to dates compatible with the new mode.
  const argsDateType = inferDateTypeFromArgs(args);
  if (argsDateType !== undefined && argsDateType !== newDateType) {
    delete currentValues.date;
    delete currentValues.startDate;
    delete currentValues.endDate;
  }

  const candidates = Array.isArray(args.candidates)
    ? (args.candidates as { id: string; label: string }[]).filter(
        (c) => typeof c?.id === "string" && typeof c?.label === "string",
      )
    : undefined;
  const multiMatchHintForRebuild =
    typeof args.multiMatchQuery === "string"
      ? formatEditMultiMatchHint(
          candidates?.length ?? 0,
          "task",
          args.multiMatchQuery,
          { truncated: (candidates?.length ?? 0) > 100 },
        )
      : undefined;

  const newView = buildViewForOpen({
    kind: "task",
    mode: proposal.kind === "edit" ? "edit" : "create",
    proposalId,
    args,
    retainerMode: false,
    currentValues,
    baselineHint: BASELINE_PARENT_PICKER_HINT,
    multiMatchCandidates: candidates,
    multiMatchHint: multiMatchHintForRebuild,
  });

  if (newView) {
    try {
      await getSlackClient().views.update({
        view_id: view.id,
        hash: typeof view.hash === "string" ? view.hash : undefined,
        view: newView as never,
      } as Parameters<ReturnType<typeof getSlackClient>["views"]["update"]>[0]);
    } catch (err) {
      // hash_conflict races are acceptable - Slack will sync state on the
      // next interaction. Log for visibility but don't fail the handler.
      console.error("[slack-interactivity] date_type views.update failed", err);
    }
  }

  return new Response("OK", { status: 200 });
}

// -----------------------------------------------------------------------------
// client_select cascade. Slack input-block external_select state.values does
// NOT propagate into block_suggestion payloads, so the Parent picker's
// options-provider cannot read the chosen client from view.state.values.
// We use private_metadata as the carrier: when the user picks a client we
// rebuild the modal via views.update with clientId encoded in
// private_metadata. The Parent picker then cascades cleanly off it.
// Edit-mode opens already serialize clientId at first render via the view
// builder, so this handler only fires on subsequent client changes.
// -----------------------------------------------------------------------------

async function handleClientSelectCascade(
  payload: SlackBlockActionsPayload,
  action: SlackAction,
): Promise<Response> {
  const view = payload.view;
  if (!view?.id) {
    return new Response("OK", { status: 200 });
  }

  const callbackId = view.callback_id;
  const isTask =
    callbackId === "runway_new_task" || callbackId === "runway_edit_task";
  const isProject =
    callbackId === "runway_new_project" || callbackId === "runway_edit_project";
  if (!isTask && !isProject) {
    // Team Member modal has a Client picker but no parent cascade; nothing
    // to rebuild. Other modals are not expected to fire this action.
    return new Response("OK", { status: 200 });
  }

  const newClientId = action.selected_option?.value;
  if (!newClientId) {
    return new Response("OK", { status: 200 });
  }

  const meta = parsePrivateMetadata(view.private_metadata);
  const proposalId = meta.proposalId;
  if (!proposalId) {
    return new Response("OK", { status: 200 });
  }

  const proposal = await loadProposal(proposalId);
  if (!proposal) {
    return new Response("OK", { status: 200 });
  }

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(proposal.args ?? "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }

  const stateValues = isStateValuesShape(view.state?.values)
    ? view.state.values
    : {};

  const preserved = isTask
    ? extractTaskCurrentValuesFromState(stateValues)
    : extractProjectCurrentValuesFromState(stateValues);

  const currentValues: Record<string, unknown> = {
    ...args,
    ...preserved,
    clientId: newClientId,
  };

  // Reset stale parent selection: the previously-picked parent is tied to
  // the old client and no longer valid. View builder skips initial_option
  // when the field is undefined, so the picker renders empty.
  if (isTask) {
    currentValues.projectId = undefined;
  } else if (!meta.retainerMode) {
    // Project non-retainer mode: parent_retainer_picker reads parentProjectId.
    // Retainer mode: no parent picker rendered, nothing to clear.
    currentValues.parentProjectId = undefined;
  }

  // Preserve disambiguation-phase fields when the user picks a client
  // before picking a candidate. args.candidates being set means the
  // candidate picker should still render after the cascade rebuild.
  const candidates = Array.isArray(args.candidates)
    ? (args.candidates as { id: string; label: string }[]).filter(
        (c) => typeof c?.id === "string" && typeof c?.label === "string",
      )
    : undefined;
  const multiMatchHintForRebuild =
    typeof args.multiMatchQuery === "string"
      ? formatEditMultiMatchHint(
          candidates?.length ?? 0,
          isTask ? "task" : "project",
          args.multiMatchQuery,
          { truncated: (candidates?.length ?? 0) > 100 },
        )
      : undefined;

  const newView = buildViewForOpen({
    kind: isTask ? "task" : "project",
    mode: proposal.kind === "edit" ? "edit" : "create",
    proposalId,
    args,
    retainerMode: meta.retainerMode === true,
    currentValues,
    baselineHint: BASELINE_PARENT_PICKER_HINT,
    multiMatchCandidates: candidates,
    multiMatchHint: multiMatchHintForRebuild,
  });

  if (newView) {
    try {
      await getSlackClient().views.update({
        view_id: view.id,
        hash: typeof view.hash === "string" ? view.hash : undefined,
        view: newView as never,
      } as Parameters<ReturnType<typeof getSlackClient>["views"]["update"]>[0]);
    } catch (err) {
      // hash_conflict races are acceptable - Slack will sync on the next
      // interaction. Log for visibility but don't fail the handler.
      console.error("[slack-interactivity] client_select views.update failed", err);
    }
  }

  return new Response("OK", { status: 200 });
}

// -----------------------------------------------------------------------------
// multi_match_candidate_select - the Wave 2 picker dispatcher. Wave 1 added a
// static_select block to all three edit modals when fuzzy match returned more
// than one candidate. The block fires a block_actions event on pick; this
// handler:
//   1. Resolves the proposal via private_metadata.
//   2. No-ops on terminal proposal status, missing proposal, or non-edit
//      toolName (the picker is only rendered in edit flows; a create-flow
//      proposal hitting this branch is a stale-event guard).
//   3. Loads the picked entity row via the shared loadEntityById helper.
//   4. On hit: persists targetEntityId/Type, rebuilds the modal in the
//      prefilled-edit phase (currentValues set, no candidates, no error).
//   5. On miss (race - row deleted between fuzzy lookup and pick): leaves the
//      proposal untouched and re-renders the disambiguation phase with a
//      Civ-voice errorBlock telling the user to start over.
// All views.update failures (hash_conflict and otherwise) are swallowed with
// console.error so the handler always acks 200.
// -----------------------------------------------------------------------------

const ROW_GONE_MESSAGE =
  "That entity is gone now. Try a fresh /runway-edit-... query.";

const LOAD_FAILED_MESSAGE =
  "Couldn't load that entity right now. Try the slash command again.";

/**
 * Defensive cap on selected_option.value length (Wave 6 / Fix 6.10). Real
 * entity ids are 25-char base32-like strings; anything north of 100 chars is
 * a malformed or hostile payload and gets dropped.
 */
const SELECTED_VALUE_MAX_LEN = 100;

/**
 * Resolve the views.update hash from the inbound view, logging a single
 * warning when it's missing so we still know we lost race detection on this
 * call (Wave 6 / Fix 6.9). The user-visible behavior is unchanged - we still
 * dispatch the views.update.
 */
function resolveViewHash(
  view: SlackView,
  proposalId: string,
): string | undefined {
  if (typeof view.hash === "string" && view.hash.length > 0) return view.hash;
  console.warn(
    "[slack-interactivity] views.update without hash, race detection lost",
    { proposalId },
  );
  return undefined;
}

async function handleMultiMatchCandidateSelect(
  payload: SlackBlockActionsPayload,
  action: SlackAction,
): Promise<Response> {
  const view = payload.view;
  if (!view?.id) {
    return new Response("OK", { status: 200 });
  }

  const meta = parsePrivateMetadata(view.private_metadata);
  const proposalId = meta.proposalId;
  if (!proposalId) {
    return new Response("OK", { status: 200 });
  }

  // Wave 6 / Fix 6.10: validate selected_option.value before passing it to
  // the row loader. Trim, drop empty, and reject pathologically long values.
  const selectedRaw =
    action.selected_option?.value ?? action.selected_options?.[0]?.value ?? undefined;
  if (typeof selectedRaw !== "string") {
    return new Response("OK", { status: 200 });
  }
  const selected = selectedRaw.trim();
  if (selected.length === 0) {
    return new Response("OK", { status: 200 });
  }
  if (selected.length > SELECTED_VALUE_MAX_LEN) {
    console.warn(
      "[slack-interactivity] multi_match_candidate_select dropped oversized selected_option.value",
      { proposalId, length: selected.length },
    );
    return new Response("OK", { status: 200 });
  }

  // Wave 6 / Fix 6.8: this handler chain is intentionally sequential.
  // loadProposal -> ownership check -> idempotency guard -> loadEntityById ->
  // DB update -> views.update. Each step's output gates the next; do not try
  // to parallelize without rethinking the data flow.
  const proposal = await loadProposal(proposalId);
  if (!proposal) {
    return new Response("OK", { status: 200 });
  }

  // Terminal-state guard: pending is the only status where a transition is
  // valid. Anything else (submitted/cancelled/expired/failed) means the
  // proposal lifecycle has closed and a stale picker click should not mutate
  // state or re-open a view.
  if (proposal.status !== "pending") {
    return new Response("OK", { status: 200 });
  }

  // Ownership guard (defense-in-depth): only the user who staged the
  // proposal may resolve its picker. Slack's trigger_id user-scoping closes
  // the realistic threat model, but a stale-event from another workspace
  // user should never mutate this proposal.
  if (proposal.userSlackId !== payload.user?.id) {
    return new Response("OK", { status: 200 });
  }

  // Defensive: the picker only renders in edit flows. A create-flow proposal
  // reaching this branch is a stale Slack event; ignore it cleanly.
  const isEditTool =
    proposal.toolName === "update_week_item" ||
    proposal.toolName === "update_project" ||
    proposal.toolName === "update_team_member";
  if (!isEditTool) {
    return new Response("OK", { status: 200 });
  }

  const kind = toolKind(proposal.toolName);
  const targetType =
    kind === "task" ? "week_item" : kind === "project" ? "project" : "team_member";

  // Parse args once; we either replay them on miss or rebuild without
  // candidates on hit.
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(proposal.args ?? "{}") as Record<string, unknown>;
  } catch {
    args = {};
  }

  // Wave 6 / Fix 6.1: idempotency by candidates presence. The first pick
  // clears `args.candidates` (see the happy-path strip below). Subsequent
  // picks observe the cleared shape and become DB-write no-ops; the
  // double-pick is treated as a stale Slack double-fire. We still attempt
  // views.update so Slack acks cleanly (its hash check resolves the UI
  // race). Skipping the loadEntityById call here also means we avoid an
  // extra DB roundtrip on a no-op path.
  const candidatesRaw = (args as { candidates?: unknown }).candidates;
  const candidatesPresent =
    Array.isArray(candidatesRaw) && candidatesRaw.length > 0;
  if (!candidatesPresent) {
    // Stale double-pick: rebuild the prefilled edit view from whatever args
    // already carry (the first pick stripped candidates and may also have
    // filled in fields). No DB write, no row load.
    const newView = buildViewForOpen({
      kind,
      mode: "edit",
      proposalId,
      args,
      retainerMode: meta.retainerMode === true,
      currentValues: args,
      baselineHint: kind === "team-member" ? undefined : BASELINE_PARENT_PICKER_HINT,
    });
    if (newView) {
      try {
        await getSlackClient().views.update({
          view_id: view.id,
          hash: resolveViewHash(view, proposalId),
          view: newView as never,
        } as Parameters<ReturnType<typeof getSlackClient>["views"]["update"]>[0]);
      } catch (updateErr) {
        console.error(
          "[slack-interactivity] multi_match_candidate_select stale-pick views.update failed",
          updateErr,
        );
      }
    }
    return new Response("OK", { status: 200 });
  }

  let row: Record<string, unknown> | null = null;
  try {
    row = await loadEntityById(kind, selected);
  } catch (err) {
    // DB throw (e.g., upstream OOM, transient network). Don't propagate -
    // a 500 here would trigger Slack's 3x retry. Re-render the
    // disambiguation phase with a Civ-voice errorBlock distinct from the
    // row-gone copy. Proposal is intentionally NOT mutated.
    console.error(
      "[slack-interactivity] loadEntityById failed",
      { err, kind, id: selected },
    );

    const candidates = Array.isArray(candidatesRaw)
      ? (candidatesRaw as Array<{ id?: unknown; label?: unknown }>)
          .filter(
            (c) => typeof c?.id === "string" && typeof c?.label === "string",
          )
          .map((c) => ({ id: c.id as string, label: c.label as string }))
      : [];

    const newView = buildViewForOpen({
      kind,
      mode: "edit",
      proposalId,
      args,
      retainerMode: meta.retainerMode === true,
      multiMatchCandidates: candidates,
      errorBlock: {
        blockId: "load_failed_block",
        message: LOAD_FAILED_MESSAGE,
      },
    });

    if (newView) {
      try {
        await getSlackClient().views.update({
          view_id: view.id,
          hash: resolveViewHash(view, proposalId),
          view: newView as never,
        } as Parameters<ReturnType<typeof getSlackClient>["views"]["update"]>[0]);
      } catch (updateErr) {
        // hash_conflict and other update errors are swallowed - we still
        // ack 200 so Slack stops retrying.
        console.error(
          "[slack-interactivity] multi_match_candidate_select load-failed views.update failed",
          updateErr,
        );
      }
    }
    return new Response("OK", { status: 200 });
  }

  if (!row) {
    // Race: the row was deleted between the fuzzy lookup and the user's pick.
    // Keep the proposal in the disambiguation phase so the user can pick a
    // different candidate, but surface the miss via an errorBlock. Proposal
    // is intentionally NOT mutated.
    const candidates = Array.isArray(candidatesRaw)
      ? (candidatesRaw as Array<{ id?: unknown; label?: unknown }>)
          .filter(
            (c) => typeof c?.id === "string" && typeof c?.label === "string",
          )
          .map((c) => ({ id: c.id as string, label: c.label as string }))
      : [];

    const newView = buildViewForOpen({
      kind,
      mode: "edit",
      proposalId,
      args,
      retainerMode: meta.retainerMode === true,
      multiMatchCandidates: candidates,
      errorBlock: { blockId: "row_gone_block", message: ROW_GONE_MESSAGE },
    });

    if (newView) {
      try {
        await getSlackClient().views.update({
          view_id: view.id,
          hash: resolveViewHash(view, proposalId),
          view: newView as never,
        } as Parameters<ReturnType<typeof getSlackClient>["views"]["update"]>[0]);
      } catch (err) {
        // hash_conflict and other update errors are swallowed - we still ack
        // 200 so Slack stops retrying.
        console.error(
          "[slack-interactivity] multi_match_candidate_select row-gone views.update failed",
          err,
        );
      }
    }
    return new Response("OK", { status: 200 });
  }

  // Happy path: persist the pick on the proposal row. Drop `candidates` from
  // args so a downstream re-open does not re-render the picker.
  const argsWithoutCandidates: Record<string, unknown> = { ...args };
  delete (argsWithoutCandidates as { candidates?: unknown }).candidates;
  delete (argsWithoutCandidates as { multiMatchQuery?: unknown }).multiMatchQuery;

  // Validate targetEntityType against the schema-truth enum before INSERT
  // (Wave 6 / Fix 6.12 runtime guard - schema migration to add a CHECK is
  // out of scope for this fixup). The enum is fixed at the toolKind ->
  // targetType mapping above; this assertion catches any drift at the only
  // write site.
  if (
    targetType !== "week_item" &&
    targetType !== "project" &&
    targetType !== "team_member"
  ) {
    console.error(
      "[slack-interactivity] refusing to write unrecognized targetEntityType",
      { proposalId, targetType },
    );
    return new Response("OK", { status: 200 });
  }

  // Bug B/C enrichment: the DB row's resources land as a CSV string
  // ("Role: Name, Role: Name"); buildResourcesBlocks expects a string[].
  // Convert here so the rebuild AND any subsequent cascade rebuild (which
  // reads from persisted args) get the right shape. Empty/missing -> []
  // so callers can rely on Array.isArray().
  const rawResources = (row as { resources?: unknown }).resources;
  let resourcesArray: string[] = [];
  if (typeof rawResources === "string") {
    resourcesArray = rawResources
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } else if (Array.isArray(rawResources)) {
    resourcesArray = rawResources.filter(
      (x): x is string => typeof x === "string" && x.length > 0,
    );
  }

  // Bug A enrichment: resolve clientId -> clientName and (for task/project
  // rows) resolve the parent project FK -> projectName so picker labels
  // render the human-readable name, not the ulid.
  let resolvedClientName: string | undefined;
  let resolvedProjectName: string | undefined;
  const rowClientId = (row as { clientId?: unknown }).clientId;
  if (typeof rowClientId === "string" && rowClientId.length > 0) {
    try {
      resolvedClientName = await getClientNameById(rowClientId);
    } catch (lookupErr) {
      console.error(
        "[slack-interactivity] getClientNameById failed during pick enrichment",
        { proposalId, clientId: rowClientId, lookupErr },
      );
    }
  }
  // Task: row.projectId is the parent project FK.
  // Project: row.parentProjectId is the parent retainer FK.
  // Team-member: no parent FK to resolve (kind === 'team-member').
  const parentFk =
    kind === "task"
      ? (row as { projectId?: unknown }).projectId
      : kind === "project"
        ? (row as { parentProjectId?: unknown }).parentProjectId
        : undefined;
  if (
    typeof parentFk === "string" &&
    parentFk.length > 0 &&
    typeof rowClientId === "string" &&
    rowClientId.length > 0
  ) {
    try {
      const projectsForClient = await getProjectsForClient(rowClientId);
      const match = projectsForClient.find((p) => p.id === parentFk);
      if (match) resolvedProjectName = match.name;
    } catch (lookupErr) {
      console.error(
        "[slack-interactivity] getProjectsForClient failed during pick enrichment",
        { proposalId, clientId: rowClientId, lookupErr },
      );
    }
  }

  // Bug C: persist enriched row data into proposal.args so subsequent
  // cascade rebuilds (date_type toggle, client switch) inherit prefill
  // defaults from args. Slack's view.state.values only contains
  // user-touched blocks, so without this persistence the cascade rebuilds
  // would wipe Owner / Notes / Resources / etc. The merge order is
  // {...originalArgs, ...row, <enriched>}: row wins over original args
  // (the picked candidate is the source of truth for fields like title,
  // owner, notes), and enriched fields win over both (clientName,
  // projectName, resources-as-array).
  const enrichedArgs: Record<string, unknown> = {
    ...argsWithoutCandidates,
    ...row,
    resources: resourcesArray,
  };
  if (resolvedClientName) enrichedArgs.clientName = resolvedClientName;
  if (resolvedProjectName) enrichedArgs.projectName = resolvedProjectName;

  // Defensive: spreading row may have re-introduced legacy or stale fields.
  // candidates / multiMatchQuery were already cleared above and shouldn't
  // appear on the row, but keep the deletes so we never resurrect the
  // disambiguation phase by accident.
  delete (enrichedArgs as { candidates?: unknown }).candidates;
  delete (enrichedArgs as { multiMatchQuery?: unknown }).multiMatchQuery;

  await getRunwayDb()
    .update(botModalProposals)
    .set({
      targetEntityId: selected,
      targetEntityType: targetType,
      args: JSON.stringify(enrichedArgs),
    })
    .where(eq(botModalProposals.id, proposalId));

  // Mirror the slash-command single-match path: currentValues is the
  // enriched args (row data + resolved labels + resources array). Using
  // enrichedArgs instead of a separate `{ ...row }` snapshot means a
  // subsequent rebuild reads the same data the cascade handlers will see
  // when they re-load proposal.args.
  const currentValues: Record<string, unknown> = { ...enrichedArgs };

  // Wave 6 / Fix 6.3: team-member fullName/name fallback. Legacy team_member
  // rows carry the picked label in `name` while the modal builder reads
  // `fullName`. Normalize here so the picker prefill matches the slash-
  // command single-match path (commands/route.ts uses the same fallback).
  if (kind === "team-member") {
    const fullName = currentValues.fullName;
    const legacyName = currentValues.name;
    if (
      (typeof fullName !== "string" || fullName.length === 0) &&
      typeof legacyName === "string" &&
      legacyName.length > 0
    ) {
      currentValues.fullName = legacyName;
    }
  }

  const newView = buildViewForOpen({
    kind,
    mode: "edit",
    proposalId,
    args: enrichedArgs,
    retainerMode: meta.retainerMode === true,
    currentValues,
    baselineHint: kind === "team-member" ? undefined : BASELINE_PARENT_PICKER_HINT,
    // No multiMatchCandidates and no errorBlock: the modal exits the
    // disambiguation phase and renders the prefilled edit form.
  });

  if (newView) {
    try {
      await getSlackClient().views.update({
        view_id: view.id,
        hash: resolveViewHash(view, proposalId),
        view: newView as never,
      } as Parameters<ReturnType<typeof getSlackClient>["views"]["update"]>[0]);
    } catch (err) {
      // hash_conflict races are acceptable - Slack will sync on the next
      // interaction. Log for visibility but don't fail the handler.
      console.error(
        "[slack-interactivity] multi_match_candidate_select views.update failed",
        err,
      );
    }
  }
  return new Response("OK", { status: 200 });
}

/**
 * Reconstruct a view-builder `currentValues` snapshot from a Task modal's
 * `view.state.values`. Preserves Title, Client, Parent, Category, Date type,
 * Date(s), Owner, Resources rows, and Notes so a re-render via views.update
 * keeps the user's in-progress input.
 *
 * Resources are rebuilt as the "Role: Name" string array shape that
 * buildResourcesBlocks expects, walking up to RESOURCES_MAX_ROWS=10 row
 * pairs.
 */
function extractTaskCurrentValuesFromState(
  state: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const cv: Record<string, unknown> = {};

  const readSelect = (block: string, action: string): string | undefined => {
    const a = (state[block]?.[action] as
      | { selected_option?: { value?: string } }
      | undefined);
    return a?.selected_option?.value;
  };
  const readSelectLabel = (block: string, action: string): string | undefined => {
    const a = (state[block]?.[action] as
      | { selected_option?: { text?: { text?: string }; value?: string } }
      | undefined);
    return a?.selected_option?.text?.text ?? a?.selected_option?.value;
  };
  const readPlain = (block: string, action: string): string | undefined => {
    const a = state[block]?.[action] as { value?: string } | undefined;
    return a?.value;
  };
  const readDate = (block: string, action: string): string | undefined => {
    const a = state[block]?.[action] as { selected_date?: string } | undefined;
    return a?.selected_date;
  };

  const clientId = readSelect("client_block", "client_select");
  if (clientId) cv.clientId = clientId;
  const projectId = readSelect("parent_project_block", "parent_project_select");
  if (projectId) cv.projectId = projectId;
  const title = readPlain("title_block", "title_input");
  if (title) cv.title = title;
  const category = readSelect("category_block", "category_select");
  if (category) cv.category = category;
  const dateType = readSelect("date_type_block", "date_type_radio");
  if (dateType) cv.dateType = dateType;
  const date = readDate("date_block", "date_picker");
  if (date) cv.date = date;
  const startDate = readDate("start_date_block", "start_date_picker");
  if (startDate) cv.startDate = startDate;
  const endDate = readDate("end_date_block", "end_date_picker");
  if (endDate) cv.endDate = endDate;
  const owner = readSelect("owner_block", "owner_select");
  if (owner) cv.owner = owner;

  // Resources: walk up to 10 row pairs. Role lives in
  // resources_block_<i>.resources_role_<i>; Name lives in
  // resources_name_block_<i>.resources_name_<i>.
  const resources: string[] = [];
  for (let i = 0; i < 10; i++) {
    const role = readSelect(`resources_block_${i}`, `resources_role_${i}`);
    const name = readSelectLabel(`resources_name_block_${i}`, `resources_name_${i}`);
    if (role && name) resources.push(`${role}: ${name}`);
    else if (name) resources.push(name);
  }
  if (resources.length > 0) cv.resources = resources;

  const notes = readPlain("notes_block", "notes_input");
  if (notes) cv.notes = notes;

  return cv;
}

/**
 * Project-modal sibling of extractTaskCurrentValuesFromState. Walks the
 * Project modal's input blocks (per src/lib/slack/modals/project.ts) and
 * reconstructs a `currentValues` shape that the view builder accepts. Used
 * when client_select cascades and we need to rebuild the view without
 * losing in-flight user input.
 */
function extractProjectCurrentValuesFromState(
  state: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const cv: Record<string, unknown> = {};

  const readSelect = (block: string, action: string): string | undefined => {
    const a = state[block]?.[action] as
      | { selected_option?: { value?: string } }
      | undefined;
    return a?.selected_option?.value;
  };
  const readSelectLabel = (block: string, action: string): string | undefined => {
    const a = state[block]?.[action] as
      | { selected_option?: { text?: { text?: string }; value?: string } }
      | undefined;
    return a?.selected_option?.text?.text ?? a?.selected_option?.value;
  };
  const readPlain = (block: string, action: string): string | undefined => {
    const a = state[block]?.[action] as { value?: string } | undefined;
    return a?.value;
  };
  const readDate = (block: string, action: string): string | undefined => {
    const a = state[block]?.[action] as { selected_date?: string } | undefined;
    return a?.selected_date;
  };
  const readCheckboxPresence = (block: string, action: string, optionValue: string): boolean => {
    const a = state[block]?.[action] as
      | { selected_options?: Array<{ value?: string }> }
      | undefined;
    if (!Array.isArray(a?.selected_options)) return false;
    return a!.selected_options.some((opt) => opt?.value === optionValue);
  };

  const clientId = readSelect("client_block", "client_select");
  if (clientId) cv.clientId = clientId;
  const engagementType = readSelect("engagement_type_block", "engagement_type_radio");
  if (engagementType) cv.engagementType = engagementType;
  if (readCheckboxPresence("is_retainer_block", "is_retainer_checkbox", "is_retainer")) {
    cv.isRetainer = true;
  }
  const name = readPlain("project_name_block", "project_name_input");
  if (name) cv.name = name;
  const parentProjectId = readSelect("parent_retainer_block", "parent_retainer_picker");
  if (parentProjectId) cv.parentProjectId = parentProjectId;
  const startDate = readDate("start_date_block", "start_date_picker");
  if (startDate) cv.startDate = startDate;
  const endDate = readDate("end_date_block", "end_date_picker");
  if (endDate) cv.endDate = endDate;
  const dueDate = readDate("due_date_block", "due_date_picker");
  if (dueDate) cv.dueDate = dueDate;
  const contractStart = readDate("contract_start_block", "contract_start_picker");
  if (contractStart) cv.contractStart = contractStart;
  const contractEnd = readDate("contract_end_block", "contract_end_picker");
  if (contractEnd) cv.contractEnd = contractEnd;
  const status = readSelect("status_block", "status_select");
  if (status) cv.status = status;
  const category = readSelect("category_block", "category_select");
  if (category) cv.category = category;
  const owner = readSelect("owner_block", "owner_select");
  if (owner) cv.owner = owner;

  const resources: string[] = [];
  for (let i = 0; i < 10; i++) {
    const role = readSelect(`resources_block_${i}`, `resources_role_${i}`);
    const member = readSelectLabel(`resources_name_block_${i}`, `resources_name_${i}`);
    if (role && member) resources.push(`${role}: ${member}`);
    else if (member) resources.push(member);
  }
  if (resources.length > 0) cv.resources = resources;

  const notes = readPlain("notes_block", "notes_input");
  if (notes) cv.notes = notes;

  return cv;
}

// -----------------------------------------------------------------------------
// view_submission dispatch - acknowledge with HTTP 200 within 3s, dispatch
// inngest event for async write. Builder 10 owns the consumer.
// -----------------------------------------------------------------------------

async function handleViewSubmission(
  payload: SlackViewSubmissionPayload,
): Promise<Response> {
  const callbackId = payload.view?.callback_id;
  if (!callbackId) {
    return new Response("Bad Request", { status: 400 });
  }
  if (!isModalCallbackId(callbackId)) {
    return new Response("Bad Request", { status: 400 });
  }

  const meta = parsePrivateMetadata(payload.view?.private_metadata);
  const proposalId = meta.proposalId;
  if (!proposalId) {
    return new Response("Bad Request", { status: 400 });
  }

  // Resolve channelId/threadTs from the proposal row (the view payload itself
  // doesn't carry channel context for view_submission). Best-effort: if the
  // lookup fails, ship an empty channelId and let Builder 10's consumer
  // surface the ambiguity to the user via the standard error path.
  let channelId = "";
  let threadTs: string | null = null;
  const proposal = await loadProposal(proposalId);
  if (proposal) {
    channelId = proposal.channelId ?? "";
    threadTs = proposal.threadTs ?? null;
  }

  const stateValuesRaw = payload.view?.state?.values;
  const stateValues = isStateValuesShape(stateValuesRaw) ? stateValuesRaw : {};

  await inngest.send({
    name: "slack-modal/submit",
    data: {
      proposalId,
      modalCallbackId: callbackId,
      stateValues,
      userId: payload.user?.id ?? "",
      teamId: payload.team?.id ?? "",
      channelId,
      threadTs,
      triggerId: payload.trigger_id ?? "",
      submittedAt: new Date().toISOString(),
    },
  });

  // The Inngest consumer takes 30-60s to write through Turso and post the
  // success/failure DM. Fire an ephemeral now so the user has an in-flight
  // signal between modal close and final DM. The ephemeral lingers after the
  // success DM arrives - that's acceptable; the DM is the authoritative signal.
  await tryPostEphemeral(channelId, payload.user?.id, MODAL_SAVE_IN_FLIGHT);

  // Empty body = "submit succeeded, close the modal". Builder 10's consumer
  // takes it from here.
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// -----------------------------------------------------------------------------
// view_closed dispatch - Builder 11 (Wave 11). When the user X-es out of a
// modal Slack delivers a `view_closed` event (provided the view was opened
// with notify_on_close=true). We:
//   1. Resolve the proposal via private_metadata.
//   2. No-op when proposal is missing or already in a terminal status
//      (submitted / cancelled / expired / failed) - keeps the handler
//      idempotent across Slack retries and out-of-order events.
//   3. Flip status to `cancelled` with `statusReason='user-dismissed'`.
//   4. Fire the proposal_cancelled lifecycle counter.
//   5. Post a Civ-voice thread reply confirming the dismiss.
// -----------------------------------------------------------------------------

const TERMINAL_PROPOSAL_STATUSES = new Set([
  "submitted",
  "cancelled",
  "expired",
  "failed",
]);

async function handleViewClosed(
  payload: SlackViewClosedPayload,
): Promise<Response> {
  const meta = parsePrivateMetadata(payload.view?.private_metadata);
  const proposalId = meta.proposalId;
  if (!proposalId) {
    // Slack delivered a view_closed without a proposalId we can match. Ack 200
    // so Slack doesn't retry, no DB write.
    return new Response("OK", { status: 200 });
  }

  const proposal = await loadProposal(proposalId);
  if (!proposal) {
    // Stale proposalId (TTL expired and was swept, or a manually crafted
    // payload). Idempotent: ack 200 with no side effect.
    return new Response("OK", { status: 200 });
  }

  if (TERMINAL_PROPOSAL_STATUSES.has(proposal.status)) {
    // Already cancelled/submitted/expired/failed - don't double-write or
    // double-post. Idempotent ack.
    return new Response("OK", { status: 200 });
  }

  // Flip the row to cancelled.
  await getRunwayDb()
    .update(botModalProposals)
    .set({ status: "cancelled", statusReason: "user-dismissed" })
    .where(eq(botModalProposals.id, proposalId));

  // Lifecycle counter for the funnel observability dashboard.
  recordProposalLifecycleTransition("proposal_cancelled", {
    proposalId,
    reason: "user-dismissed",
  });

  // Civ-voice thread reply in the original channel/thread. Best-effort - if
  // Slack rejects the post (rate-limit, channel archived, etc) we still
  // consider the cancel handled and return 200.
  const channel = proposal.channelId;
  if (channel) {
    try {
      await getSlackClient().chat.postMessage({
        channel,
        text: MODAL_CANCELLED_THREAD_REPLY,
        ...(proposal.threadTs ? { thread_ts: proposal.threadTs } : {}),
      });
    } catch (err) {
      console.error("[slack-interactivity] view_closed postMessage failed", err);
    }
  }

  return new Response("OK", { status: 200 });
}

// -----------------------------------------------------------------------------
// shortcut dispatch
// -----------------------------------------------------------------------------

async function handleShortcut(
  _payload: SlackShortcutPayload,
): Promise<Response> {
  // No global or message shortcuts wired yet. Ack so Slack doesn't retry.
  return new Response("OK", { status: 200 });
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

interface ProposalRow {
  id: string;
  toolName: string;
  kind: "create" | "edit";
  args: string;
  targetEntityId: string | null;
  targetEntityType: string | null;
  pendingProjectName: string | null;
  parentProposalId: string | null;
  intentGroupId: string | null;
  postedMessageTs: string | null;
  postedMessageChannel: string | null;
  resolvedProjectId: string | null;
  status: "pending" | "submitted" | "cancelled" | "expired" | "failed";
  expiresAt: Date | string;
  channelId: string;
  threadTs: string | null;
  userSlackId: string;
}

async function loadProposal(proposalId: string): Promise<ProposalRow | null> {
  const rows = await getRunwayDb()
    .select()
    .from(botModalProposals)
    .where(eq(botModalProposals.id, proposalId))
    .limit(1);
  const row = (rows[0] as ProposalRow | undefined) ?? null;
  return row;
}

type EntityKind = "task" | "project" | "team-member";

function toolKind(toolName: string): EntityKind {
  if (toolName === "create_project" || toolName === "update_project") return "project";
  if (toolName === "create_team_member" || toolName === "update_team_member") {
    return "team-member";
  }
  return "task";
}

interface BuildOpenInput {
  kind: EntityKind;
  mode: "create" | "edit";
  proposalId: string;
  args: Record<string, unknown>;
  retainerMode: boolean;
  baselineHint?: string;
  multiMatchHint?: string;
  currentValues?: Record<string, unknown>;
  /** Optional candidate list for the disambiguation picker. Omit once the user has picked. */
  multiMatchCandidates?: { id: string; label: string }[];
  /** Optional validator/race error to surface above the form. */
  errorBlock?: { blockId: string; message: string };
}

function buildViewForOpen(
  input: BuildOpenInput,
): Record<string, unknown> | null {
  if (input.kind === "task") {
    return buildTaskModal({
      args: input.args,
      proposalId: input.proposalId,
      mode: input.mode,
      currentValues: input.currentValues,
      baselineHint: input.baselineHint,
      multiMatchHint: input.multiMatchHint,
      multiMatchCandidates: input.multiMatchCandidates,
      errorBlock: input.errorBlock,
    }) as unknown as Record<string, unknown>;
  }
  if (input.kind === "project") {
    return buildProjectModal({
      args: input.args,
      proposalId: input.proposalId,
      mode: input.mode,
      retainerMode: input.retainerMode,
      currentValues: input.currentValues,
      baselineHint: input.baselineHint,
      multiMatchHint: input.multiMatchHint,
      multiMatchCandidates: input.multiMatchCandidates,
      errorBlock: input.errorBlock,
    }) as unknown as Record<string, unknown>;
  }
  return buildTeamMemberModal({
    args: input.args,
    proposalId: input.proposalId,
    mode: input.mode,
    currentValues: input.currentValues,
    multiMatchCandidates: input.multiMatchCandidates,
    errorBlock: input.errorBlock,
  }) as unknown as Record<string, unknown>;
}

function parsePrivateMetadata(raw: string | undefined): {
  proposalId?: string;
  clientId?: string;
  retainerMode?: boolean;
} {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    return {
      proposalId: typeof obj.proposalId === "string" ? obj.proposalId : undefined,
      clientId: typeof obj.clientId === "string" ? obj.clientId : undefined,
      retainerMode: typeof obj.retainerMode === "boolean" ? obj.retainerMode : undefined,
    };
  } catch {
    return {};
  }
}

function isStateValuesShape(
  v: unknown,
): v is Record<string, Record<string, unknown>> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Extract the toolName-appropriate title from staged args. Mirrors the
 * `extractTitle` helper in concurrency-check.ts; kept here as a thin shim so
 * the open_create_modal handler can pass `fuzzyTitle` to checkConcurrentProposal
 * without round-tripping through the helper module's private internals.
 */
function extractTitleForFuzzy(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName === "create_project" || toolName === "update_project") {
    return typeof args.name === "string" ? args.name : "";
  }
  if (toolName === "create_team_member" || toolName === "update_team_member") {
    return typeof args.fullName === "string" ? args.fullName : "";
  }
  return typeof args.title === "string" ? args.title : "";
}

async function tryPostEphemeral(
  channel: string | undefined,
  user: string | undefined,
  text: string,
): Promise<void> {
  if (!channel || !user) return;
  try {
    await getSlackClient().chat.postEphemeral({ channel, user, text });
  } catch (err) {
    console.error("[slack-interactivity] postEphemeral failed", err);
  }
}
