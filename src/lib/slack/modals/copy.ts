/**
 * Civ-voice copy module - single source of truth for all user-facing strings
 * in the Slack Modal feature.
 *
 * Civ voice rules (locked 2026-04-30):
 * - Hyphens, not em-dashes. Use ASCII hyphen-minus (' - ').
 * - No AI-sounding language.
 * - Tight, plain copy.
 * - Retainer / Project / Task hierarchy in user-facing copy. No tier-letter
 *   shorthand anywhere in this file (including comments). This file is the
 *   contract; the wave-end grep gate asserts that on the source itself.
 *
 * Every string and formatter exported here is locked by the v7 spec
 * (docs/tmp/slack-modal-pre-plan.md, "User-facing copy strings" section)
 * and the operator greenlight (docs/tmp/operator-greenlight-2026-04-30.md).
 *
 * A wave-end grep gate enforces the no-em-dash rule across user-facing
 * surfaces; this module's tests assert it directly on this source file.
 */

// ---------------------------------------------------------------------------
// Bot replies (button-bearing)
// ---------------------------------------------------------------------------

/**
 * Bot's button-bearing reply on a single create_* intercept.
 * Posted as the bot's reply to the user's natural-language message; a
 * Block Kit primary button (`action_id="open_create_modal"`) is appended
 * by the caller.
 */
export const BOT_SINGLE_INTERCEPT_REPLY =
  "📋 Got it - Click the button below to review and add any additional details, then click submit to save.";

/**
 * Bot's button-bearing reply on a multi-detect intercept (N >= 2 staged
 * proposals from one user message). Caller appends one Block Kit button per
 * staged proposal (project first, tasks after).
 */
export function formatBotMultiDetectReply(n: number): string {
  return `📋 Got it - I caught ${n} items. Click each below to review and save.`;
}

// ---------------------------------------------------------------------------
// Modal headers (type-aware: create + edit)
// ---------------------------------------------------------------------------

/**
 * Modal headers, type-aware. Create headers are static strings. Edit headers
 * are formatters that interpolate the entity's title or full name.
 *
 * Slack hard-caps modal title text at <25 chars. The static create headers
 * are kept short so the cap never trips; the edit formatters return the raw
 * `Edit X - {name}` shape and rely on the view builders to truncate the full
 * string with ' ... ' when an entity name overflows.
 *
 * All edit headers use hyphen-space-hyphen (' - '), never em-dash.
 */
export const MODAL_HEADERS = {
  newProject: "New project",
  newRetainer: "New retainer",
  newTask: "New task",
  newTeamMember: "New team member",
  editProject: (title: string) => `Edit project - ${title}`,
  editRetainer: (title: string) => `Edit retainer - ${title}`,
  editTask: (title: string) => `Edit task - ${title}`,
  editTeamMember: (fullName: string) => `Edit team member - ${fullName}`,
} as const;

// ---------------------------------------------------------------------------
// Confirmation messages (posted async after a successful submit)
// ---------------------------------------------------------------------------

export function formatProjectConfirmation(title: string, client: string): string {
  return `✅ Saved. ${title} added to ${client}.`;
}

export function formatRetainerConfirmation(title: string, client: string): string {
  return `✅ Saved. ${title} retainer added to ${client}.`;
}

export function formatTaskConfirmation(title: string, project: string): string {
  return `✅ Saved. ${title} added to ${project}.`;
}

export function formatTeamMemberConfirmation(fullName: string): string {
  return `✅ Saved. ${fullName} added to the team.`;
}

/**
 * Edit confirmation - posted after a successful edit submit.
 * `fieldSummary` is a short human-readable description of the diff
 * (e.g. "status from in_progress to completed", or "owner and dueDate").
 */
export function formatEditConfirmation(title: string, fieldSummary: string): string {
  return `✅ Updated. ${title}: changed ${fieldSummary}.`;
}

// ---------------------------------------------------------------------------
// Modal cancel / view_closed
// ---------------------------------------------------------------------------

/**
 * Posted when the user X-es out of a modal (Slack `view_closed` event).
 * The proposal is moved to status `cancelled`.
 */
export const MODAL_CANCELLED =
  "No worries - discarded that draft. DM me again when you're ready.";

/**
 * Wave 11 thread reply posted in the original channel/thread when a user
 * dismisses a modal (Slack `view_closed`). Civ-voice confirmation that the
 * draft was discarded; mirrors `MODAL_CANCELLED` but written for the channel
 * reply surface (no DM-specific phrasing).
 */
export const MODAL_CANCELLED_THREAD_REPLY =
  "Got it - dismissed without saving. Run the slash command again or ping me to start over.";

/**
 * Wave 11 concurrency soft-warn rendered as a context block above the parent
 * picker (or top of modal for non-parent modals) when caller-side lookup
 * detects another user opening a similar form in the same channel within the
 * last 60 seconds. Plain hyphen-space-hyphen, no em-dash.
 */
export function CONCURRENT_PROPOSAL_SOFT_WARN(
  otherUser: string,
  otherTitle: string,
): string {
  const titleClause = otherTitle ? `("${otherTitle}") ` : "";
  return `Heads up - <@${otherUser}> opened a similar form ${titleClause}in this channel within the last minute. Confirm before saving to avoid duplicates.`;
}

// ---------------------------------------------------------------------------
// Disabled-button click ephemeral
// ---------------------------------------------------------------------------

/**
 * Ephemeral message shown when a user clicks a task button whose parent
 * project hasn't been saved yet. Surfaces from the action handler when
 * `resolved_project_id` is null on the proposal row.
 */
export const TASK_BUTTON_DISABLED =
  "Save the project first - I'll enable this once it's saved.";

// ---------------------------------------------------------------------------
// Lazy-resolution failure (parent project lookup at submit)
// ---------------------------------------------------------------------------

/**
 * Returned to the user when a task submit can't resolve its parent project
 * (parent never saved, or proposal expired). The Inngest handler aborts the
 * write and surfaces this string as a Slack error.
 */
export const PARENT_PROJECT_NOT_FOUND =
  "Parent project not found. Save the project first, then submit this task.";

// ---------------------------------------------------------------------------
// Edit slash-command - no-match ephemeral
// ---------------------------------------------------------------------------

/**
 * Slash-command no-match ephemeral. Shown when an `/runway-edit-*` command
 * receives a name that doesn't match any entity. Tells the user to check
 * the name or fall back to the create command.
 */
export function formatEditNoMatch(
  kind: "task" | "project" | "team-member",
  name: string,
): string {
  const command = kind === "task" ? "task" : kind === "project" ? "project" : "team-member";
  return `Couldn't find a ${command} matching '${name}'. Check the name or use /runway-new-${command} to create.`;
}

// ---------------------------------------------------------------------------
// Edit slash-command - multi-match disambiguation hint
// ---------------------------------------------------------------------------

/**
 * Edit-flow multi-match hint, rendered as a section block above the
 * target-entity picker when more than one entity matches the user's name.
 */
export function formatEditMultiMatchHint(
  n: number,
  kind: "task" | "project" | "team-member",
  name: string,
): string {
  return `We found ${n} ${kind}s matching '${name}' - confirm below.`;
}

// ---------------------------------------------------------------------------
// Parent-picker hints (per v7 §A3)
// ---------------------------------------------------------------------------

/**
 * Always-on parent-picker hint, rendered as a context block (muted) directly
 * above the parent `external_select` picker in any modal that has one.
 * The Team Member modal has no parent picker and never renders this.
 */
export const BASELINE_PARENT_PICKER_HINT = "Double-check the parent before submitting.";

/**
 * Multi-match parent-picker hint, rendered as a section block (bold/emphasis)
 * directly above the baseline hint when caller-side fuzzy match returned more
 * than one candidate for the parent. Hyphen-space-hyphen, NOT em-dash.
 */
export function formatMultiMatchHint(
  n: number,
  name: string,
  kind: "project" | "retainer",
): string {
  return `We found ${n} ${kind}s matching '${name}' - confirm the parent below.`;
}

// ---------------------------------------------------------------------------
// Cascade-deadline explainer
// ---------------------------------------------------------------------------

/**
 * Rendered in the Task modal (via `views.push` or initial render) when the
 * selected category is `deadline`. Explains the asymmetric cascade: future
 * date changes flow up to the parent project's `dueDate`; other field
 * changes do not.
 */
export const CASCADE_DEADLINE_EXPLAINER =
  "⚠️ On future date changes, this updates the parent project's dueDate. endDate, status, and notes changes do NOT cascade.";

// ---------------------------------------------------------------------------
// Async-write error / validation surfaces (Wave 10)
// ---------------------------------------------------------------------------

/**
 * Ephemeral intro shown when the Inngest submit handler hits the validator
 * gate and rejects. Caller appends a per-block error map below this line.
 */
export const MODAL_VALIDATION_FAILED_INTRO =
  "Couldn't save - one or more fields need attention.";

/**
 * Thread-posted error when the operations-layer write throws (DB outage,
 * unexpected validator reject, etc). The user sees the actionable summary
 * here; the full stack lands in Inngest's run history for the operator.
 */
export function formatWriteError(detail: string): string {
  return `Couldn't save - ${detail}. Try again or check with the team.`;
}

// ---------------------------------------------------------------------------
// Validator soft-warn rendering
// ---------------------------------------------------------------------------

/**
 * Validator-rejection wrapper for the Slack `view_submission` errors map.
 * Every reject teaches the matrix inline rather than emitting a generic
 * "Invalid combination." string.
 *
 * `rule` is the validator name (e.g. "validateStatusCategoryCompatibility")
 * and is currently informational, kept in the signature so callers can
 * route different rules to different formatters in future without a
 * breaking change.
 */
export function formatValidationError(
  rule: string,
  status: string,
  category: string,
): string {
  void rule;
  return `Status \`${status}\` can't pair with category \`${category}\`. Pick \`${status}\` for the category, or change the status.`;
}
