/**
 * Team Member modal view builder (Wave 6 / Builder 6, v7).
 *
 * Pure function. Builds the Slack `views.open` payload for the Team Member
 * create + edit flows. The Team Member modal has NO parent picker (team
 * members are assigned to clients via `accountsLed`, not nested under another
 * entity), so it never renders the parent-picker hint.
 *
 * Spec sources:
 *   - docs/tmp/slack-modal-pre-plan.md (v7) - "Modal flows" Team Member,
 *     "Wave 6" section, and "C3" mode/currentValues contract.
 *   - project memory: project_slack_modal_spec.md (Modal 4 - Team Member,
 *     schema-corrected from runway-schema.ts).
 *
 * Civ voice rules (locked 2026-04-30):
 *   - Hyphens, not em-dashes. Use ASCII hyphen-minus (' - ').
 *   - No retainer/project/task hierarchy shorthand in user-facing copy.
 *   - All strings flow through `MODAL_HEADERS` (./copy.ts) where possible.
 */

import { MODAL_HEADERS } from "./copy";
import { buildMultiMatchCandidatePicker } from "./picker-block";
import { hasPickedEntity } from "./picker-state";

export interface SlackView {
  type: "modal";
  callback_id: string;
  private_metadata: string;
  title: { type: "plain_text"; text: string; emoji?: boolean };
  submit?: { type: "plain_text"; text: string; emoji?: boolean };
  close?: { type: "plain_text"; text: string; emoji?: boolean };
  blocks: Array<Record<string, unknown> & { type: string; block_id?: string }>;
  notify_on_close: true;
  clear_on_close?: boolean;
}

// Slack hard-caps modal title text at <25 chars. We truncate to 24 with " ... "
// suffix when the full edit header overflows.
const SLACK_TITLE_MAX = 24;

function truncateTitle(s: string, max: number = SLACK_TITLE_MAX): string {
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, max);
  return `${s.slice(0, max - 3)}...`;
}

// ---------------------------------------------------------------------------
// Role category options
// ---------------------------------------------------------------------------

/**
 * Schema-truth role categories from `teamMembers.roleCategory` in
 * `src/lib/db/runway-schema.ts` (line 150). All seven values are surfaced in
 * the dropdown.
 */
export const ROLE_CATEGORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "creative", label: "Creative" },
  { value: "dev", label: "Development" },
  { value: "am", label: "Account Management" },
  { value: "pm", label: "Project Management" },
  { value: "strategy", label: "Strategy" },
  { value: "leadership", label: "Leadership" },
  { value: "community", label: "Community" },
  { value: "contractor", label: "Contractor" },
];

const ROLE_CATEGORY_VALUES = new Set(ROLE_CATEGORY_OPTIONS.map((o) => o.value));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildTeamMemberModalParams {
  /**
   * LLM-extracted args from the natural-language intercept (Pattern A) or
   * slash-command empty-args proposal (Pattern B). Recognized keys:
   *   - fullName: string  -> pre-fills the full-name input
   *   - roleCategory: one of ROLE_CATEGORY_OPTIONS values -> pre-selects role
   * Unknown keys are ignored.
   */
  args: Record<string, unknown>;
  proposalId: string;
  mode: "create" | "edit";
  /**
   * Existing team_member field values, used in edit mode to pre-fill all
   * inputs. Same recognized keys as `args`. Optional in create mode.
   */
  currentValues?: Record<string, unknown>;
  /**
   * Server-side validation error to surface above the form. Rendered as a
   * section block at the top of the view. The blockId is informational so
   * the handler can highlight the offending field if desired.
   */
  errorBlock?: { blockId: string; message: string };
  /**
   * Fuzzy-match candidates from the slash-command edit flow, surfaced as a
   * static_select picker at the top of the modal so the user can disambiguate
   * without re-filling every field. The picker is rendered ONLY when
   * `currentValues` is undefined or has no entity-identifying field set;
   * once the user picks a candidate (block_actions handler in a later wave)
   * the modal is re-opened with `currentValues` populated and the picker
   * disappears.
   */
  multiMatchCandidates?: { id: string; label: string }[];
}

// ---------------------------------------------------------------------------
// Multi-match candidate picker
// ---------------------------------------------------------------------------
//
// The picker block itself (label, placeholder, 75-char + 100-option caps,
// id-suffix description) is the shared `buildMultiMatchCandidatePicker` from
// ./picker-block.ts. Wave 7 / Fix 7.1 collapsed the per-modal duplicates.

/**
 * The picker should render only when the caller has not yet identified the
 * target team member. Wave 6 / Fix 6.2 unified this behind the shared
 * `hasPickedEntity` predicate so the per-kind picked check stays consistent
 * across task / project / team-member builders. The team-member predicate
 * accepts `fullName` OR legacy `name` as the picked signal.
 */
function shouldRenderCandidatePicker(
  candidates: ReadonlyArray<{ id: string; label: string }> | undefined,
  currentValues: Record<string, unknown> | undefined,
): boolean {
  if (!candidates || candidates.length === 0) return false;
  return !hasPickedEntity(currentValues, "team-member");
}

export function buildTeamMemberModal(params: BuildTeamMemberModalParams): SlackView {
  const { args, proposalId, mode, currentValues, errorBlock, multiMatchCandidates } =
    params;

  const source = mode === "edit" ? { ...args, ...(currentValues ?? {}) } : args;

  const fullName = typeof source.fullName === "string" ? source.fullName : "";
  const roleCategoryRaw =
    typeof source.roleCategory === "string" ? source.roleCategory : "";
  const roleCategory = ROLE_CATEGORY_VALUES.has(roleCategoryRaw) ? roleCategoryRaw : "";

  // Wave 6 / Fix 6.5: when the modal renders in disambiguation phase (edit
  // flow with multi-match candidates and no entity picked yet), use the
  // explicit pick header instead of "Edit team member - " (trailing hyphen
  // + empty fullName).
  const showCandidatePicker = shouldRenderCandidatePicker(
    multiMatchCandidates,
    currentValues,
  );
  const headerText = truncateTitle(
    mode === "edit"
      ? showCandidatePicker
        ? MODAL_HEADERS.pickTeamMember
        : MODAL_HEADERS.editTeamMember(fullName)
      : MODAL_HEADERS.newTeamMember,
  );

  const callbackId =
    mode === "edit" ? "runway_edit_team_member" : "runway_new_team_member";

  const blocks: SlackView["blocks"] = [];

  if (errorBlock) {
    blocks.push({
      type: "section",
      block_id: "error_block",
      text: { type: "mrkdwn", text: `:warning: ${errorBlock.message}` },
    });
  }

  // Multi-match candidate picker - rendered at the top (after any error block)
  // and BEFORE the first input block, so the user sees their disambiguation
  // choice immediately. Only rendered when fuzzy match returned candidates and
  // the user has not yet picked one (no entity-identifying field in
  // currentValues). dispatch_action wires the picker into a block_actions
  // handler in a later wave.
  if (showCandidatePicker) {
    blocks.push(
      buildMultiMatchCandidatePicker(
        "team-member",
        multiMatchCandidates as ReadonlyArray<{ id: string; label: string }>,
      ) as SlackView["blocks"][number],
    );
  }

  // No client picker on the team-member modal: the team_members schema has no
  // client_id column. Cross-client membership lives in `accountsLed` (JSON
  // array of client slugs) which is not surfaced here. An earlier draft
  // rendered a placeholder client_select that the route handler was supposed
  // to patch with live options at views.open time; that handler never landed,
  // and the value never flowed to the write path either. Removing the block
  // keeps the modal aligned with the schema and unblocks team-member CRUD
  // via Slack.

  // Full name (required).
  blocks.push({
    type: "input",
    block_id: "name_block",
    label: { type: "plain_text", text: "Full name" },
    element: {
      type: "plain_text_input",
      action_id: "name_input",
      placeholder: { type: "plain_text", text: "e.g. Sam Rivera" },
      ...(fullName ? { initial_value: fullName } : {}),
    },
  });

  // Role category (required).
  const roleOptions = ROLE_CATEGORY_OPTIONS.map((opt) => ({
    text: { type: "plain_text" as const, text: opt.label },
    value: opt.value,
  }));
  const initialRoleOption = roleCategory
    ? roleOptions.find((o) => o.value === roleCategory)
    : undefined;

  blocks.push({
    type: "input",
    block_id: "role_category_block",
    label: { type: "plain_text", text: "Role category" },
    element: {
      type: "static_select",
      action_id: "role_category_select",
      placeholder: { type: "plain_text", text: "Pick a role" },
      options: roleOptions,
      ...(initialRoleOption ? { initial_option: initialRoleOption } : {}),
    },
  });

  // No email block on the team-member modal: the team_members schema has no
  // email column, so collected values were silently dropped on create and the
  // edit-flow diff (computeChangedFields' hasOwnProperty guard) skipped the
  // field entirely - changing ONLY email left changedFields empty and the
  // validator rejected the submit with "no changes detected." Remove the
  // block to keep the modal aligned with the schema.

  return {
    type: "modal",
    callback_id: callbackId,
    private_metadata: JSON.stringify({ proposalId }),
    title: { type: "plain_text", text: headerText },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    notify_on_close: true,
    blocks,
  };
}
