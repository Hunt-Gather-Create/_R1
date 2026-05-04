/**
 * Project modal view builder (create + edit) with the retainer-checkbox
 * conditional collapsed into a single builder per pre-plan v7 §B6.
 *
 * Pure function that returns a Slack Block Kit `view` payload for the
 * Project modal flow. Used by:
 *   - Wave 8 button-click handler (open_create_modal action)
 *   - Wave 8 block_actions handler for the is_retainer_checkbox toggle
 *     (re-renders the same view with the opposite retainerMode flag,
 *      preserving user-typed values via initial_value propagation)
 *   - Wave 9 view_submission validation tier (re-renders with errorBlock)
 *   - The slash-command edit flow (loads currentValues from DB, mode="edit")
 *
 * Spec sources (locked):
 *   - docs/tmp/slack-modal-pre-plan.md (v7) - "Modal flows" (line 376),
 *     §A3 hint render order, §B5 datepicker-only dates, §B6 single Project
 *     builder, §C3 mode/currentValues + edit headers
 *   - project_slack_modal_spec.md (Modal 2 + Modal 3 field design)
 *
 * Civ voice (LOCKED): hyphens not em-dashes, no AI-sounding language, plain
 * copy. No tier-letter shorthand in user-facing strings (the
 * Retainer / Project / Task hierarchy is exposed via plain English labels).
 * A source-level grep guard in project.test.ts asserts these on this file.
 *
 * Hint render order (per v7 §A3, only when retainerMode=false; top to bottom,
 * optional blocks elided):
 *   (1) errorBlock (Phase 2/3 will pass)
 *   (2) multiMatchHint section block (bold/emphasis)
 *   (3) baselineHint context block (muted)
 *   (4) parent-retainer external_select picker
 *
 * In retainer mode, the parent picker is removed (server-side enforces
 * parentProjectId=null) and BOTH hint blocks are suppressed regardless of
 * caller input.
 *
 * Resources repeater is capped at 10 rows.
 */

import {
  BASELINE_PARENT_PICKER_HINT,
  MODAL_HEADERS,
} from "./copy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Slack Block Kit view payload (loose typing). Mirrors task.ts. The runtime
 * contract here is the JSON shape that views.open / views.update accept; we
 * keep this loose because the @slack/web-api types pin many element shapes
 * more tightly than we need at the boundary, and the interactivity tests
 * assert specific block_id presence rather than full schema conformance.
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

export interface BuildProjectModalParams {
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
   * When true, render the retainer variant of the modal:
   *   - Header swaps to the retainer string
   *   - is_retainer checkbox is checked
   *   - engagementType becomes a read-only context block ("Retainer (locked)")
   *   - parent retainer picker is hidden (server-side enforces null)
   *   - contractStart and contractEnd datepickers are surfaced
   *   - hint blocks are suppressed regardless of caller input
   */
  retainerMode: boolean;
  /**
   * Pre-fill values, propagated to every block's `initial_value` /
   * `initial_option` / `initial_date`. In edit mode also drives the header.
   */
  currentValues?: Record<string, unknown>;
  /**
   * Always-on parent-picker hint, rendered as a context block above the
   * picker. Caller passes the locked `BASELINE_PARENT_PICKER_HINT` constant
   * to enable; omit to disable. Suppressed in retainer mode.
   */
  baselineHint?: string;
  /**
   * Multi-match parent-picker hint, rendered as a section block above the
   * baseline. Pass the formatted string from `formatMultiMatchHint(...)` when
   * caller-side fuzzy match returned more than one candidate. Suppressed in
   * retainer mode.
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

// Project-status enum per src/lib/db/runway-schema.ts (projects table).
// Schema-truth status set: not-started, in-production, awaiting-client, blocked,
// on-hold, completed.
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "not-started", label: "Not started" },
  { value: "in-production", label: "In production" },
  { value: "awaiting-client", label: "Awaiting client" },
  { value: "blocked", label: "Blocked" },
  { value: "on-hold", label: "On hold" },
  { value: "completed", label: "Completed" },
];

// Schema-truth category set: active, awaiting-client, pipeline, on-hold, completed.
const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "active", label: "Active" },
  { value: "awaiting-client", label: "Awaiting client" },
  { value: "pipeline", label: "Pipeline" },
  { value: "on-hold", label: "On hold" },
  { value: "completed", label: "Completed" },
];

// engagementType radio options shown in project mode (retainer is the locked
// context label, never a selectable option in the radio).
const ENGAGEMENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "project", label: "Project" },
  { value: "break-fix", label: "Break-fix" },
];

// Resource role labels per project_slack_modal_spec.md Modal 2.
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

function header(
  mode: "create" | "edit",
  retainerMode: boolean,
  currentValues?: Record<string, unknown>,
): string {
  if (mode === "create") {
    return retainerMode ? MODAL_HEADERS.newRetainer : MODAL_HEADERS.newProject;
  }
  const nameRaw = (currentValues?.name as string | undefined) ?? "";
  const full = retainerMode
    ? MODAL_HEADERS.editRetainer(nameRaw)
    : MODAL_HEADERS.editProject(nameRaw);
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
    element.initial_option = staticOption({ value: initialClient, label: initialClient });
  }
  return {
    type: "input",
    block_id: "client_block",
    label: plainText("Client"),
    // dispatch_action fires block_actions on Client pick. The handler writes
    // the chosen clientId into private_metadata so the cascading Parent
    // retainer picker's options-provider can read it. Input-block
    // external_select state.values does NOT propagate into block_suggestion
    // payloads, so private_metadata is the only reliable carrier.
    dispatch_action: true,
    element,
  };
}

function buildIsRetainerBlock(retainerMode: boolean) {
  // Slack checkboxes need at least one selectable option to render. The single
  // checkbox flips between "is a retainer" and not.
  const option = staticOption({ value: "is_retainer", label: "This is a retainer wrapper" });
  const element: Record<string, unknown> = {
    type: "checkboxes",
    action_id: "is_retainer_checkbox",
    options: [option],
  };
  if (retainerMode) element.initial_options = [option];
  return {
    type: "input",
    block_id: "is_retainer_block",
    label: plainText("Retainer wrapper"),
    optional: true,
    // Toggle re-renders via response_action: "update". dispatch_action triggers
    // a block_actions event the moment the user flips the checkbox.
    dispatch_action: true,
    element,
  };
}

function buildProjectNameBlock(currentValues?: Record<string, unknown>) {
  const initial = asString(currentValues?.name);
  const element: Record<string, unknown> = {
    type: "plain_text_input",
    action_id: "project_name_input",
    placeholder: plainText("Short, specific name"),
  };
  if (initial) element.initial_value = initial;
  return {
    type: "input",
    block_id: "project_name_block",
    label: plainText("Project name"),
    element,
  };
}

function buildEngagementTypeRadioBlock(currentValues?: Record<string, unknown>) {
  const initial =
    findOption(ENGAGEMENT_TYPE_OPTIONS, asString(currentValues?.engagementType)) ??
    ENGAGEMENT_TYPE_OPTIONS[0];
  return {
    type: "input",
    block_id: "engagement_type_block",
    label: plainText("Engagement type"),
    element: {
      type: "radio_buttons",
      action_id: "engagement_type_radio",
      options: ENGAGEMENT_TYPE_OPTIONS.map(staticOption),
      initial_option: staticOption(initial),
    },
  };
}

function buildEngagementTypeLockedBlock() {
  // Read-only context block in retainer mode. The submit handler ignores any
  // submitted radio value and writes engagementType=retainer.
  return {
    type: "context",
    block_id: "engagement_type_block",
    elements: [mrkdwn("Engagement type: Retainer (locked)")],
  };
}

function buildParentRetainerBlock(currentValues?: Record<string, unknown>) {
  const initial = asString(currentValues?.parentProjectId);
  const element: Record<string, unknown> = {
    type: "external_select",
    action_id: "parent_retainer_picker",
    placeholder: plainText("Search retainer wrappers"),
    min_query_length: 0,
  };
  if (initial) {
    element.initial_option = staticOption({ value: initial, label: initial });
  }
  return {
    type: "input",
    block_id: "parent_retainer_block",
    label: plainText("Parent retainer"),
    optional: true,
    element,
  };
}

function buildStatusBlock(currentValues?: Record<string, unknown>) {
  const initial = findOption(STATUS_OPTIONS, asString(currentValues?.status));
  const element: Record<string, unknown> = {
    type: "static_select",
    action_id: "status_select",
    placeholder: plainText("Pick a status"),
    options: STATUS_OPTIONS.map(staticOption),
  };
  if (initial) element.initial_option = staticOption(initial);
  return {
    type: "input",
    block_id: "status_block",
    label: plainText("Status"),
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
 * add an Add Row button via block_actions; this builder renders the static
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
    // server's options-provider endpoint.
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

function buildDateBlock(
  blockId: string,
  actionId: string,
  label: string,
  initial: string | undefined,
  optional: boolean,
) {
  const element: Record<string, unknown> = {
    type: "datepicker",
    action_id: actionId,
    placeholder: plainText("Pick a date"),
  };
  if (initial) element.initial_date = initial;
  return {
    type: "input",
    block_id: blockId,
    label: plainText(label),
    optional,
    element,
  };
}

function buildNotesBlock(currentValues?: Record<string, unknown>) {
  const initial = asString(currentValues?.notes);
  const element: Record<string, unknown> = {
    type: "plain_text_input",
    action_id: "notes_input",
    multiline: true,
    placeholder: plainText("Highlights only. Project identity + shape constraint."),
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

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

export function buildProjectModal(params: BuildProjectModalParams): SlackView {
  const {
    proposalId,
    mode,
    retainerMode,
    currentValues,
    baselineHint,
    multiMatchHint,
    errorBlock,
  } = params;

  const blocks: SlackView["blocks"] = [];

  // 1. Client picker
  blocks.push(buildClientBlock(currentValues) as SlackView["blocks"][number]);

  // 2. Error block (validator-injected, Phase 2/3)
  if (errorBlock) {
    blocks.push(buildErrorBlock(errorBlock) as SlackView["blocks"][number]);
  }

  // 3. is_retainer checkbox (always rendered; toggled via dispatch_action)
  blocks.push(buildIsRetainerBlock(retainerMode) as SlackView["blocks"][number]);

  // 4. Project name
  blocks.push(buildProjectNameBlock(currentValues) as SlackView["blocks"][number]);

  if (retainerMode) {
    // 5a. Engagement type (locked context block)
    blocks.push(buildEngagementTypeLockedBlock() as SlackView["blocks"][number]);
    // No parent picker. No hint blocks.
  } else {
    // 5b. Engagement type (radio: Project / Break-fix)
    blocks.push(
      buildEngagementTypeRadioBlock(currentValues) as SlackView["blocks"][number],
    );
    // 6. Multi-match hint (when caller-side fuzzy match returned >1 candidate)
    if (multiMatchHint) {
      blocks.push(
        buildMultiMatchHintBlock(multiMatchHint) as SlackView["blocks"][number],
      );
    }
    // 7. Baseline hint (always-on when caller passes the locked constant)
    if (baselineHint) {
      blocks.push(
        buildBaselineHintBlock(baselineHint) as SlackView["blocks"][number],
      );
    }
    // Reference the locked constant so the import is load-bearing for callers
    // who import this module's types alongside copy.ts.
    void BASELINE_PARENT_PICKER_HINT;
    // 8. Parent retainer picker
    blocks.push(
      buildParentRetainerBlock(currentValues) as SlackView["blocks"][number],
    );
  }

  // 9. Status
  blocks.push(buildStatusBlock(currentValues) as SlackView["blocks"][number]);

  // 10. Category
  blocks.push(buildCategoryBlock(currentValues) as SlackView["blocks"][number]);

  // 11. Owner
  blocks.push(buildOwnerBlock(currentValues) as SlackView["blocks"][number]);

  // 12. Resources rows (max 10)
  for (const b of buildResourcesBlocks(currentValues)) {
    blocks.push(b as SlackView["blocks"][number]);
  }

  // 13. Start date / End date / Due date - datepickers, optional at the
  // builder level. Wave 9 enforces conditional required-ness against the
  // status + engagementType matrix server-side.
  blocks.push(
    buildDateBlock(
      "start_date_block",
      "start_date_picker",
      "Start date",
      asString(currentValues?.startDate),
      true,
    ) as SlackView["blocks"][number],
  );
  blocks.push(
    buildDateBlock(
      "end_date_block",
      "end_date_picker",
      "End date",
      asString(currentValues?.endDate),
      true,
    ) as SlackView["blocks"][number],
  );
  blocks.push(
    buildDateBlock(
      "due_date_block",
      "due_date_picker",
      "Due date",
      asString(currentValues?.dueDate),
      true,
    ) as SlackView["blocks"][number],
  );

  // 14. Contract dates (retainer mode only)
  if (retainerMode) {
    blocks.push(
      buildDateBlock(
        "contract_start_block",
        "contract_start_picker",
        "Contract start",
        asString(currentValues?.contractStart),
        true,
      ) as SlackView["blocks"][number],
    );
    blocks.push(
      buildDateBlock(
        "contract_end_block",
        "contract_end_picker",
        "Contract end",
        asString(currentValues?.contractEnd),
        true,
      ) as SlackView["blocks"][number],
    );
  }

  // 15. Notes
  blocks.push(buildNotesBlock(currentValues) as SlackView["blocks"][number]);

  // private_metadata carries proposalId, retainerMode, and clientId across
  // renders. clientId is encoded so the Parent retainer picker (non-retainer
  // mode) can cascade off it via the options-provider. Edit-mode opens with
  // a prefilled clientId; create-mode opens without and gains it after the
  // client_select cascade fires.
  const meta: Record<string, unknown> = { proposalId, retainerMode };
  const clientIdForMeta = asString(currentValues?.clientId);
  if (clientIdForMeta) meta.clientId = clientIdForMeta;

  return {
    type: "modal",
    callback_id: mode === "create" ? "runway_new_project" : "runway_edit_project",
    private_metadata: JSON.stringify(meta),
    title: plainText(header(mode, retainerMode, currentValues)),
    submit: plainText(truncate("Save", SLACK_TITLE_MAX)),
    close: plainText(truncate("Cancel", SLACK_TITLE_MAX)),
    blocks,
    notify_on_close: true,
  };
}

// ---------------------------------------------------------------------------
// Ephemeral retainer-toggle helper (Wave 8 #33 pattern)
// ---------------------------------------------------------------------------

/**
 * Block actions payload shape (loose). We only read the few fields the helper
 * actually needs - everything else is tolerated noise.
 */
export interface BlockActionsPayload {
  type: "block_actions";
  trigger_id?: string;
  view?: {
    id?: string;
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, unknown>>;
    };
  };
  actions?: Array<{
    action_id?: string;
    type?: string;
    selected_options?: Array<{ value?: string }>;
  }>;
}

export interface RetainerToggleResponseAction {
  response_action: "update";
  view: SlackView;
}

/**
 * Read the current view's state.values, harvest user-typed values, flip
 * retainerMode to the value implied by the checkbox's selected_options, and
 * re-render the modal via buildProjectModal. Returns a Slack
 * `response_action: "update"` payload that Wave 8's interactivity handler
 * sends back as the response body.
 *
 * Value preservation contract: any field the user has typed/selected before
 * the toggle MUST round-trip through currentValues so the new view's
 * initial_value / initial_option / initial_date keeps it visible.
 */
export function buildEphemeralRetainerToggle(
  payload: BlockActionsPayload,
): RetainerToggleResponseAction {
  const meta = parsePrivateMetadata(payload.view?.private_metadata);
  const proposalId = meta.proposalId ?? "";
  const newRetainerMode = readRetainerCheckboxState(payload);
  const currentValues = harvestStateValues(payload.view?.state?.values ?? {});

  // Default mode for the toggle re-render is "create" - toggles only fire
  // before submit, and edit-mode modals don't expose the checkbox toggle
  // (edit-mode form is committed against an existing row). We carry a
  // baselineHint when the new mode is project (retainerMode=false) so the
  // user sees the always-on hint above the parent picker.
  return {
    response_action: "update",
    view: buildProjectModal({
      args: {},
      proposalId,
      mode: "create",
      retainerMode: newRetainerMode,
      currentValues,
      baselineHint: newRetainerMode ? undefined : BASELINE_PARENT_PICKER_HINT,
    }),
  };
}

function parsePrivateMetadata(raw: string | undefined): {
  proposalId?: string;
  retainerMode?: boolean;
} {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      proposalId: typeof parsed.proposalId === "string" ? parsed.proposalId : undefined,
      retainerMode:
        typeof parsed.retainerMode === "boolean" ? parsed.retainerMode : undefined,
    };
  } catch {
    return {};
  }
}

function readRetainerCheckboxState(payload: BlockActionsPayload): boolean {
  // Prefer the action's own selected_options (the toggle that just fired);
  // fall back to the state.values snapshot.
  const action = payload.actions?.find(
    (a) => a.action_id === "is_retainer_checkbox",
  );
  if (action) {
    const selected = action.selected_options ?? [];
    return selected.some((o) => o.value === "is_retainer");
  }
  const block = payload.view?.state?.values?.is_retainer_block as
    | Record<string, unknown>
    | undefined;
  const cb = block?.is_retainer_checkbox as
    | { selected_options?: Array<{ value?: string }> }
    | undefined;
  return (cb?.selected_options ?? []).some((o) => o.value === "is_retainer");
}

/**
 * Walk Slack's `state.values` shape and pull out the user-typed values we
 * care about, mapping them onto the currentValues shape buildProjectModal
 * consumes. Slack's state.values is a two-level map keyed by block_id then
 * action_id; element shapes vary by element type.
 */
function harvestStateValues(
  values: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  // Helpers
  const readPlainText = (block: string, action: string): string | undefined => {
    const el = (values[block]?.[action] as { value?: unknown } | undefined) ?? undefined;
    if (typeof el?.value === "string" && el.value.length > 0) return el.value;
    return undefined;
  };
  const readSelectValue = (block: string, action: string): string | undefined => {
    const el = values[block]?.[action] as
      | {
          selected_option?: { value?: unknown };
          selected_options?: Array<{ value?: unknown }>;
        }
      | undefined;
    if (typeof el?.selected_option?.value === "string") return el.selected_option.value;
    const first = el?.selected_options?.[0]?.value;
    if (typeof first === "string") return first;
    return undefined;
  };
  const readDate = (block: string, action: string): string | undefined => {
    const el = values[block]?.[action] as { selected_date?: unknown } | undefined;
    if (typeof el?.selected_date === "string" && el.selected_date.length > 0) {
      return el.selected_date;
    }
    return undefined;
  };

  const name = readPlainText("project_name_block", "project_name_input");
  if (name) out.name = name;

  const clientId = readSelectValue("client_block", "client_select");
  if (clientId) out.clientId = clientId;

  const engagementType = readSelectValue(
    "engagement_type_block",
    "engagement_type_radio",
  );
  if (engagementType) out.engagementType = engagementType;

  const parentProjectId = readSelectValue(
    "parent_retainer_block",
    "parent_retainer_picker",
  );
  if (parentProjectId) out.parentProjectId = parentProjectId;

  const status = readSelectValue("status_block", "status_select");
  if (status) out.status = status;

  const category = readSelectValue("category_block", "category_select");
  if (category) out.category = category;

  const owner = readSelectValue("owner_block", "owner_select");
  if (owner) out.owner = owner;

  const startDate = readDate("start_date_block", "start_date_picker");
  if (startDate) out.startDate = startDate;
  const endDate = readDate("end_date_block", "end_date_picker");
  if (endDate) out.endDate = endDate;
  const dueDate = readDate("due_date_block", "due_date_picker");
  if (dueDate) out.dueDate = dueDate;
  const contractStart = readDate("contract_start_block", "contract_start_picker");
  if (contractStart) out.contractStart = contractStart;
  const contractEnd = readDate("contract_end_block", "contract_end_picker");
  if (contractEnd) out.contractEnd = contractEnd;

  const notes = readPlainText("notes_block", "notes_input");
  if (notes) out.notes = notes;

  // Resources rows - walk indices 0..9 looking for either role or name selects.
  const resources: string[] = [];
  for (let i = 0; i < RESOURCES_MAX_ROWS; i++) {
    const role = readSelectValue(`resources_block_${i}`, `resources_role_${i}`);
    const nameSel = readSelectValue(
      `resources_name_block_${i}`,
      `resources_name_${i}`,
    );
    if (role && nameSel) {
      resources.push(`${role}: ${nameSel}`);
    } else if (nameSel) {
      resources.push(nameSel);
    }
  }
  if (resources.length > 0) out.resources = resources;

  return out;
}
