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

import type { ModalView } from "@slack/types";
import { MODAL_HEADERS } from "./copy";

export type SlackView = ModalView;

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
   *   - clientId: string  -> pre-selects the client dropdown
   *   - roleCategory: one of ROLE_CATEGORY_OPTIONS values -> pre-selects role
   *   - email: string     -> pre-fills the email input
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
}

export function buildTeamMemberModal(params: BuildTeamMemberModalParams): SlackView {
  const { args, proposalId, mode, currentValues, errorBlock } = params;

  const source = mode === "edit" ? { ...args, ...(currentValues ?? {}) } : args;

  const fullName = typeof source.fullName === "string" ? source.fullName : "";
  const clientId = typeof source.clientId === "string" ? source.clientId : "";
  const email = typeof source.email === "string" ? source.email : "";
  const roleCategoryRaw =
    typeof source.roleCategory === "string" ? source.roleCategory : "";
  const roleCategory = ROLE_CATEGORY_VALUES.has(roleCategoryRaw) ? roleCategoryRaw : "";

  const headerText = truncateTitle(
    mode === "edit" ? MODAL_HEADERS.editTeamMember(fullName) : MODAL_HEADERS.newTeamMember,
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

  // Client picker - assigns the team member to a client by accountsLed.
  blocks.push({
    type: "input",
    block_id: "client_block",
    label: { type: "plain_text", text: "Client" },
    element: {
      type: "static_select",
      action_id: "client_select",
      placeholder: { type: "plain_text", text: "Pick a client" },
      ...(clientId
        ? {
            initial_option: {
              text: { type: "plain_text", text: clientId },
              value: clientId,
            },
          }
        : {}),
      // Real options are injected at render time by the route handler from a
      // live client list. The builder leaves `options` as a single
      // placeholder so Slack accepts the view; the handler patches it before
      // calling views.open. (Slack rejects static_select with empty options.)
      options: [{ text: { type: "plain_text", text: " " }, value: "__placeholder__" }],
    },
  });

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

  // Email (optional).
  blocks.push({
    type: "input",
    block_id: "email_block",
    optional: true,
    label: { type: "plain_text", text: "Email" },
    element: {
      type: "plain_text_input",
      action_id: "email_input",
      placeholder: { type: "plain_text", text: "name@example.com" },
      ...(email ? { initial_value: email } : {}),
    },
  });

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
