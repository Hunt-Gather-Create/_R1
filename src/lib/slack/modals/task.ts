/**
 * Task modal view builder (create + edit).
 *
 * Pure function that returns a Slack Block Kit `view` payload for the task
 * modal flow. Used by:
 *   - Wave 8 button-click handler (open_create_modal action)
 *   - Wave 9 view_submission validation tier (re-renders with errorBlock)
 *   - The slash-command edit flow (loads currentValues from DB, mode="edit")
 *
 * Spec sources (locked):
 *   - docs/tmp/slack-modal-pre-plan.md (v7) - Modal flows + Wave 4
 *   - docs/tmp/slack-modal-pre-plan.md (v7) - A3, hint render order
 *   - docs/tmp/slack-modal-pre-plan.md (v7) - B5, all date inputs use datepicker
 *   - project_slack_modal_spec.md (Modal 1, Task field design)
 *
 * Civ voice (LOCKED): hyphens not em-dashes, no AI-sounding language, plain
 * copy. No tier-letter shorthand in user-facing strings (the parent project /
 * task hierarchy is exposed via plain English labels). A source-level grep
 * guard in task.test.ts asserts these on this file.
 *
 * Hint render order (per v7 A3, top to bottom, optional blocks elided):
 *   (1) errorBlock (Phase 2/3 will pass)
 *   (2) multiMatchHint section block (bold/emphasis)
 *   (3) baselineHint context block (muted)
 *   (4) parent-project external_select picker
 *
 * Resources repeater is capped at 10 rows.
 */

import {
  BASELINE_PARENT_PICKER_HINT,
  CASCADE_DEADLINE_EXPLAINER,
  MODAL_HEADERS,
} from "./copy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Slack Block Kit view payload (loose typing). The runtime contract here is
 * the JSON shape that views.open / views.update accept; we keep this loose
 * because the @slack/web-api types pin many element shapes more tightly than
 * we need at the boundary, and Wave 8/9 tests assert specific block_id
 * presence rather than full schema conformance.
 */
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

export interface BuildTaskModalParams {
  /**
   * The original tool args from the bot intercept (or empty for slash-command
   * launch). Currently informational - currentValues wins on every conflict.
   * Kept in the signature so Wave 8 callers can route inferred fields through
   * without an extra merge step at the call site.
   */
  args: Record<string, unknown>;
  /** Proposal row id; serialized into private_metadata. */
  proposalId: string;
  mode: "create" | "edit";
  /**
   * Pre-fill values, propagated to every block's `initial_value` /
   * `initial_option` / `initial_date`. In edit mode also drives the header.
   */
  currentValues?: Record<string, unknown>;
  /**
   * Always-on parent-picker hint, rendered as a context block above the
   * picker. Caller passes the locked `BASELINE_PARENT_PICKER_HINT` constant
   * to enable; omit to disable.
   */
  baselineHint?: string;
  /**
   * Multi-match parent-picker hint, rendered as a section block above the
   * baseline. Pass the formatted string from `formatMultiMatchHint(...)` when
   * caller-side fuzzy match returned more than one candidate.
   */
  multiMatchHint?: string;
  /**
   * Phase 2/3 validation tier passes a soft-warn or hard-reject error block
   * here so it renders above the rest of the form.
   */
  errorBlock?: { blockId: string; message: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLACK_TITLE_MAX = 24; // Slack modal title cap
const RESOURCES_MAX_ROWS = 10;

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "delivery", label: "Delivery" },
  { value: "kickoff", label: "Kickoff" },
  { value: "review", label: "Review" },
  { value: "approval", label: "Approval" },
  { value: "deadline", label: "Deadline" },
  { value: "launch", label: "Launch" },
];

const DATE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "single", label: "Single day" },
  { value: "range", label: "Range" },
];

// Resource role labels per project_slack_modal_spec.md Modal 1.
const RESOURCE_ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "AM", label: "AM" },
  { value: "CD", label: "CD" },
  { value: "Dev", label: "Dev" },
  { value: "CW", label: "CW" },
  { value: "PM", label: "PM" },
  { value: "CM", label: "CM" },
  { value: "Strat", label: "Strat" },
  { value: "Vendor", label: "Vendor" },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function plainText(text: string, emoji = true) {
  return { type: "plain_text" as const, text, emoji };
}

function mrkdwn(text: string) {
  return { type: "mrkdwn" as const, text };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, max);
  return `${s.slice(0, max - 3)}...`;
}

function header(mode: "create" | "edit", currentValues?: Record<string, unknown>): string {
  if (mode === "create") return MODAL_HEADERS.newTask;
  const titleRaw = (currentValues?.title as string | undefined) ?? "";
  const full = MODAL_HEADERS.editTask(titleRaw);
  return truncate(full, SLACK_TITLE_MAX);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : undefined;
}

function findOption(
  options: Array<{ value: string; label: string }>,
  v: string | undefined,
): { value: string; label: string } | undefined {
  if (!v) return undefined;
  return options.find((o) => o.value === v);
}

function staticOption(o: { value: string; label: string }) {
  return { text: plainText(o.label), value: o.value };
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function buildClientBlock(currentValues?: Record<string, unknown>) {
  const initialClient = asString(currentValues?.clientId);
  const element: Record<string, unknown> = {
    type: "external_select",
    action_id: "client_select",
    placeholder: plainText("Pick a client"),
    min_query_length: 0,
  };
  if (initialClient) {
    // Caller's options-provider returns the resolved label for this id; we
    // surface the id-only so submit can read state.values cleanly. Slack
    // requires the full {text, value} shape on initial_option, so we
    // round-trip the id as the visible text - the live picker re-fetches
    // the label via the options-provider on first interaction.
    element.initial_option = staticOption({ value: initialClient, label: initialClient });
  }
  return {
    type: "input",
    block_id: "client_block",
    label: plainText("Client"),
    element,
  };
}

function buildParentProjectBlock(currentValues?: Record<string, unknown>) {
  const initialProject = asString(currentValues?.projectId);
  const element: Record<string, unknown> = {
    type: "external_select",
    action_id: "parent_project_select",
    placeholder: plainText("Search projects"),
    min_query_length: 0,
  };
  if (initialProject) {
    element.initial_option = staticOption({
      value: initialProject,
      label: initialProject,
    });
  }
  return {
    type: "input",
    block_id: "parent_project_block",
    label: plainText("Parent project"),
    element,
  };
}

function buildTitleBlock(currentValues?: Record<string, unknown>) {
  const initial = asString(currentValues?.title);
  const element: Record<string, unknown> = {
    type: "plain_text_input",
    action_id: "title_input",
    placeholder: plainText("Short, specific name"),
  };
  if (initial) element.initial_value = initial;
  return {
    type: "input",
    block_id: "title_block",
    label: plainText("Title"),
    element,
  };
}

function buildCategoryBlock(currentValues?: Record<string, unknown>) {
  const initial = findOption(CATEGORY_OPTIONS, asString(currentValues?.category));
  const element: Record<string, unknown> = {
    type: "static_select",
    action_id: "category_select",
    placeholder: plainText("Pick a category"),
    options: CATEGORY_OPTIONS.map(staticOption),
  };
  if (initial) element.initial_option = staticOption(initial);
  return {
    type: "input",
    block_id: "category_block",
    label: plainText("Category"),
    element,
  };
}

function buildDateTypeBlock(currentValues?: Record<string, unknown>) {
  const initial =
    findOption(DATE_TYPE_OPTIONS, asString(currentValues?.dateType)) ?? DATE_TYPE_OPTIONS[0];
  return {
    type: "input",
    block_id: "date_type_block",
    label: plainText("Date type"),
    element: {
      type: "radio_buttons",
      action_id: "date_type_radio",
      options: DATE_TYPE_OPTIONS.map(staticOption),
      initial_option: staticOption(initial),
    },
  };
}

function buildDateBlock(currentValues?: Record<string, unknown>) {
  const initial = asString(currentValues?.date);
  const element: Record<string, unknown> = {
    type: "datepicker",
    action_id: "date_picker",
    placeholder: plainText("Pick a date"),
  };
  if (initial) element.initial_date = initial;
  return {
    type: "input",
    block_id: "date_block",
    label: plainText("Date"),
    element,
  };
}

function buildStartDateBlock(currentValues?: Record<string, unknown>) {
  const initial = asString(currentValues?.startDate);
  const element: Record<string, unknown> = {
    type: "datepicker",
    action_id: "start_date_picker",
    placeholder: plainText("Pick a start date"),
  };
  if (initial) element.initial_date = initial;
  return {
    type: "input",
    block_id: "start_date_block",
    label: plainText("Start date"),
    element,
  };
}

function buildOwnerBlock(currentValues?: Record<string, unknown>) {
  const initial = asString(currentValues?.owner);
  const element: Record<string, unknown> = {
    type: "external_select",
    action_id: "owner_select",
    placeholder: plainText("Pick an owner"),
    min_query_length: 0,
  };
  if (initial) {
    element.initial_option = staticOption({ value: initial, label: initial });
  }
  return {
    type: "input",
    block_id: "owner_block",
    label: plainText("Owner"),
    element,
  };
}

/**
 * Resources repeater rows. Each row is a Role static_select + a Name
 * external_select side by side. Repeater is capped at 10 rows; the row count
 * is driven by `currentValues.resources` length (string array). Wave 8 may
 * add an Add Row button via block_actions; Wave 4 just renders the static
 * row count.
 */
function buildResourcesBlocks(
  currentValues?: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const list = asStringArray(currentValues?.resources) ?? [];
  const rowCount = Math.min(Math.max(list.length, 1), RESOURCES_MAX_ROWS);
  const blocks: Array<Record<string, unknown>> = [];

  for (let i = 0; i < rowCount; i++) {
    const entry = list[i];
    // Entry shape "Role: Name" (e.g. "CW: Kathy"). Split for pre-fill.
    let initialRole: string | undefined;
    let initialName: string | undefined;
    if (entry) {
      const colon = entry.indexOf(":");
      if (colon > 0) {
        initialRole = entry.slice(0, colon).trim();
        initialName = entry.slice(colon + 1).trim();
      } else {
        initialName = entry;
      }
    }
    const roleOption = findOption(RESOURCE_ROLE_OPTIONS, initialRole);

    const roleElement: Record<string, unknown> = {
      type: "static_select",
      action_id: `resources_role_${i}`,
      placeholder: plainText("Role"),
      options: RESOURCE_ROLE_OPTIONS.map(staticOption),
    };
    if (roleOption) roleElement.initial_option = staticOption(roleOption);

    // Resources Name picker is an external_select (typeahead). Slack rejects
    // a static_select with an empty options array, and the team-member list
    // is dynamic + workspace-scoped, so the picker fetches options from the
    // server's options-provider endpoint. Edit-mode pre-fill round-trips the
    // raw name as label since we don't have the team-member id here.
    const nameElement: Record<string, unknown> = {
      type: "external_select",
      action_id: `resources_name_${i}`,
      placeholder: plainText("Name"),
      min_query_length: 0,
    };
    if (initialName) {
      nameElement.initial_option = staticOption({
        value: initialName,
        label: initialName,
      });
    }

    blocks.push({
      type: "section",
      block_id: `resources_block_${i}`,
      text: mrkdwn(i === 0 ? "*Resources*" : " "),
      accessory: roleElement,
    });
    blocks.push({
      type: "section",
      block_id: `resources_name_block_${i}`,
      text: mrkdwn(" "),
      accessory: nameElement,
    });
  }
  return blocks;
}

function buildNotesBlock(currentValues?: Record<string, unknown>) {
  const initial = asString(currentValues?.notes);
  const element: Record<string, unknown> = {
    type: "plain_text_input",
    action_id: "notes_input",
    multiline: true,
    placeholder: plainText("One sentence. Names actor + deliverable."),
  };
  if (initial) element.initial_value = initial;
  return {
    type: "input",
    block_id: "notes_block",
    label: plainText("Notes"),
    optional: true,
    element,
  };
}

function buildErrorBlock(errorBlock: { blockId: string; message: string }) {
  return {
    type: "section",
    block_id: errorBlock.blockId,
    text: mrkdwn(`:warning: ${errorBlock.message}`),
  };
}

function buildMultiMatchHintBlock(message: string) {
  // Section block with bold/emphasis. Slack mrkdwn uses *text* for bold.
  return {
    type: "section",
    block_id: "multi_match_hint_block",
    text: mrkdwn(`*${message}*`),
  };
}

function buildBaselineHintBlock(message: string) {
  // Context block renders muted, smaller text - the right surface for an
  // always-on advisory line above the picker.
  return {
    type: "context",
    block_id: "baseline_hint_block",
    elements: [mrkdwn(message)],
  };
}

function buildCascadeDeadlineBlock() {
  return {
    type: "context",
    block_id: "cascade_deadline_explainer_block",
    elements: [mrkdwn(CASCADE_DEADLINE_EXPLAINER)],
  };
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

export function buildTaskModal(params: BuildTaskModalParams): SlackView {
  const { proposalId, mode, currentValues, baselineHint, multiMatchHint, errorBlock } =
    params;

  const dateType =
    asString(currentValues?.dateType) === "range" ? "range" : "single";
  const category = asString(currentValues?.category);

  const blocks: SlackView["blocks"] = [];

  // 1. Client picker
  blocks.push(buildClientBlock(currentValues) as SlackView["blocks"][number]);

  // 2. Error block (validator-injected, Phase 2/3)
  if (errorBlock) {
    blocks.push(buildErrorBlock(errorBlock) as SlackView["blocks"][number]);
  }

  // 3. Multi-match hint (when caller-side fuzzy match returned >1 candidate)
  if (multiMatchHint) {
    blocks.push(
      buildMultiMatchHintBlock(multiMatchHint) as SlackView["blocks"][number],
    );
  }

  // 4. Baseline hint (always-on when caller passes the locked constant)
  if (baselineHint) {
    blocks.push(buildBaselineHintBlock(baselineHint) as SlackView["blocks"][number]);
  }
  // Reference the locked constant so the import is load-bearing for callers
  // who import this module's types.
  void BASELINE_PARENT_PICKER_HINT;

  // 5. Parent project picker (typeahead)
  blocks.push(
    buildParentProjectBlock(currentValues) as SlackView["blocks"][number],
  );

  // 6. Title
  blocks.push(buildTitleBlock(currentValues) as SlackView["blocks"][number]);

  // 7. Category
  blocks.push(buildCategoryBlock(currentValues) as SlackView["blocks"][number]);

  // 8. Date type radio (drives start_date visibility)
  blocks.push(buildDateTypeBlock(currentValues) as SlackView["blocks"][number]);

  // 9. Date (always rendered)
  blocks.push(buildDateBlock(currentValues) as SlackView["blocks"][number]);

  // 10. Start date (only when date type = range)
  if (dateType === "range") {
    blocks.push(buildStartDateBlock(currentValues) as SlackView["blocks"][number]);
  }

  // 11. Owner
  blocks.push(buildOwnerBlock(currentValues) as SlackView["blocks"][number]);

  // 12. Resources rows (max 10)
  for (const b of buildResourcesBlocks(currentValues)) {
    blocks.push(b as SlackView["blocks"][number]);
  }

  // 13. Notes
  blocks.push(buildNotesBlock(currentValues) as SlackView["blocks"][number]);

  // 14. Cascade-deadline explainer (only when category=deadline)
  if (category === "deadline") {
    blocks.push(buildCascadeDeadlineBlock() as SlackView["blocks"][number]);
  }

  return {
    type: "modal",
    callback_id: mode === "create" ? "runway_new_task" : "runway_edit_task",
    private_metadata: JSON.stringify({ proposalId }),
    title: plainText(header(mode, currentValues)),
    submit: plainText(truncate("Save", SLACK_TITLE_MAX)),
    close: plainText(truncate("Cancel", SLACK_TITLE_MAX)),
    blocks,
    notify_on_close: true,
  };
}
