/**
 * Tests for buildTaskModal — the Task modal view builder (create + edit).
 *
 * Reference: pre-plan v7 §A3 §3-§4 + Wave 4. The builder must:
 *   - Emit a Slack Block Kit `view` payload with header
 *     "New task" (create) or "Edit task - {title}" (edit).
 *   - Render the parent-picker hint stack in spec order:
 *       (1) optional error block (Phase 2/3 will pass via `errorBlock`)
 *       (2) optional `multiMatchHint` as a `section` block with bold/emphasis
 *       (3) optional `baselineHint` as a `context` block (muted)
 *       (4) the parent-project `external_select` typeahead picker
 *   - Use `datepicker` for every date input (no free-text dates per v7 §B5).
 *   - Cap the resources repeater at 10 rows.
 *   - Render the cascade-deadline explainer context block when category=deadline.
 *   - Truncate the header to Slack's 24-char title cap with ellipsis when the
 *     edit title is too long.
 *
 * Source-level grep guard ensures task.ts itself contains no em-dashes or
 * tier-letter shorthand in user-facing strings.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildTaskModal } from "./task";
import { BASELINE_PARENT_PICKER_HINT, CASCADE_DEADLINE_EXPLAINER } from "./copy";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Block = Record<string, unknown> & { type: string; block_id?: string };

function findBlock(view: { blocks: Block[] }, blockId: string): Block | undefined {
  return view.blocks.find((b) => b.block_id === blockId);
}

function indexOfBlock(view: { blocks: Block[] }, blockId: string): number {
  return view.blocks.findIndex((b) => b.block_id === blockId);
}

// ---------------------------------------------------------------------------
// Header (create vs edit) and shell
// ---------------------------------------------------------------------------

describe("buildTaskModal — shell (create mode)", () => {
  it("renders the create header verbatim", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_create_001",
      mode: "create",
    });
    expect(view.title.text).toBe("New task");
  });

  it("uses callback_id 'runway_new_task' in create mode", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_create_002",
      mode: "create",
    });
    expect(view.callback_id).toBe("runway_new_task");
  });

  it("serializes proposalId into private_metadata as JSON", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_abc_123",
      mode: "create",
    });
    const meta = JSON.parse(view.private_metadata);
    expect(meta.proposalId).toBe("prop_abc_123");
  });

  it("omits clientId from private_metadata when currentValues.clientId is unset (create mode)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_no_client_001",
      mode: "create",
    });
    const meta = JSON.parse(view.private_metadata);
    expect(meta.clientId).toBeUndefined();
  });

  it("serializes clientId into private_metadata when currentValues.clientId is set", () => {
    // Cascade case: client_select handler rebuilds the view with new clientId
    // in currentValues. The view builder threads it into private_metadata so
    // the Parent picker's options-provider can read it.
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_with_client_001",
      mode: "create",
      currentValues: { clientId: "client_42" },
    });
    const meta = JSON.parse(view.private_metadata);
    expect(meta.proposalId).toBe("prop_with_client_001");
    expect(meta.clientId).toBe("client_42");
  });

  it("emits 'Save' submit and 'Cancel' close labels", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_create_003",
      mode: "create",
    });
    expect(view.submit?.text).toBe("Save");
    expect(view.close?.text).toBe("Cancel");
  });

  it("declares modal type and notify_on_close so view_closed fires on cancel", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_create_004",
      mode: "create",
    });
    expect(view.type).toBe("modal");
    expect(view.notify_on_close).toBe(true);
  });
});

describe("buildTaskModal — shell (edit mode)", () => {
  it("renders 'Edit task - {title}' header derived from currentValues.title", () => {
    // Short titles that fit under Slack's 24-char modal title cap render verbatim.
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_edit_001",
      mode: "edit",
      currentValues: { title: "Hero" }, // 4 chars -> "Edit task - Hero" = 16 chars, fits.
    });
    expect(view.title.text).toBe("Edit task - Hero");
  });

  it("truncates titles that overflow the 24-char cap with ellipsis", () => {
    // 'Concept Writeup' is 15 chars; full header is 27 chars and overflows.
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_edit_001b",
      mode: "edit",
      currentValues: { title: "Concept Writeup" },
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.startsWith("Edit task - ")).toBe(true);
    expect(view.title.text.endsWith("...")).toBe(true);
  });

  it("uses callback_id 'runway_edit_task' in edit mode", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_edit_002",
      mode: "edit",
      currentValues: { title: "Anything" },
    });
    expect(view.callback_id).toBe("runway_edit_task");
  });

  it("truncates the edit header to Slack's 24-char title cap with an ellipsis", () => {
    const longTitle = "An Extremely Long Task Title That Will Not Fit In Slack Header";
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_edit_003",
      mode: "edit",
      currentValues: { title: longTitle },
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.endsWith("...")).toBe(true);
  });

  it("falls back to a stable header when currentValues.title is missing", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_edit_004",
      mode: "edit",
    });
    expect(view.title.text).toMatch(/^Edit task/);
    expect(view.title.text.length).toBeLessThanOrEqual(24);
  });
});

// ---------------------------------------------------------------------------
// Pre-fill from currentValues (edit mode)
// ---------------------------------------------------------------------------

describe("buildTaskModal — edit mode pre-fill", () => {
  const currentValues = {
    title: "Draft homepage hero",
    clientId: "client_ag1_001",
    projectId: "proj_ag1_pro_2026",
    category: "delivery",
    dateType: "single",
    date: "2026-05-04",
    owner: "tm_kathy_001",
    resources: "CW: Kathy",
    notes: "Hero card draft.",
  };

  it("propagates title into the title input's initial_value", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_edit_prefill_001",
      mode: "edit",
      currentValues,
    });
    const titleBlock = findBlock(view, "title_block") as Block;
    const element = titleBlock.element as { initial_value?: string };
    expect(element.initial_value).toBe("Draft homepage hero");
  });

  it("propagates date into the datepicker's initial_date", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_edit_prefill_002",
      mode: "edit",
      currentValues,
    });
    const dateBlock = findBlock(view, "date_block") as Block;
    const element = dateBlock.element as { initial_date?: string };
    expect(element.initial_date).toBe("2026-05-04");
  });

  it("propagates category into the category select's initial_option", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_edit_prefill_003",
      mode: "edit",
      currentValues,
    });
    const catBlock = findBlock(view, "category_block") as Block;
    const element = catBlock.element as { initial_option?: { value?: string } };
    expect(element.initial_option?.value).toBe("delivery");
  });

  it("propagates dateType into the radio's initial_option", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_edit_prefill_004",
      mode: "edit",
      currentValues,
    });
    const radioBlock = findBlock(view, "date_type_block") as Block;
    const element = radioBlock.element as { initial_option?: { value?: string } };
    expect(element.initial_option?.value).toBe("single");
  });

  it("propagates notes into the notes input's initial_value", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_edit_prefill_005",
      mode: "edit",
      currentValues,
    });
    const notesBlock = findBlock(view, "notes_block") as Block;
    const element = notesBlock.element as { initial_value?: string };
    expect(element.initial_value).toBe("Hero card draft.");
  });
});

// ---------------------------------------------------------------------------
// Parent-picker hint render order (v7 §A3)
// ---------------------------------------------------------------------------

describe("buildTaskModal — parent-picker hint render order", () => {
  it("renders only the picker when both hints are undefined", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_hint_001",
      mode: "create",
    });
    expect(findBlock(view, "multi_match_hint_block")).toBeUndefined();
    expect(findBlock(view, "baseline_hint_block")).toBeUndefined();
    expect(findBlock(view, "parent_project_block")).toBeDefined();
  });

  it("renders only the baseline + picker when only baselineHint is provided", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_hint_002",
      mode: "create",
      baselineHint: BASELINE_PARENT_PICKER_HINT,
    });
    expect(findBlock(view, "multi_match_hint_block")).toBeUndefined();
    const baselineIdx = indexOfBlock(view, "baseline_hint_block");
    const pickerIdx = indexOfBlock(view, "parent_project_block");
    expect(baselineIdx).toBeGreaterThan(-1);
    expect(pickerIdx).toBeGreaterThan(-1);
    expect(baselineIdx).toBeLessThan(pickerIdx);
  });

  it("renders multi-match THEN baseline THEN picker when both hints are provided", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_hint_003",
      mode: "create",
      baselineHint: BASELINE_PARENT_PICKER_HINT,
      multiMatchHint: "We found 3 projects matching 'AG1' - confirm the parent below.",
    });
    const multiIdx = indexOfBlock(view, "multi_match_hint_block");
    const baselineIdx = indexOfBlock(view, "baseline_hint_block");
    const pickerIdx = indexOfBlock(view, "parent_project_block");
    expect(multiIdx).toBeGreaterThan(-1);
    expect(baselineIdx).toBeGreaterThan(-1);
    expect(pickerIdx).toBeGreaterThan(-1);
    expect(multiIdx).toBeLessThan(baselineIdx);
    expect(baselineIdx).toBeLessThan(pickerIdx);
  });

  it("renders multi-match as a section block with bold/emphasis (asterisk markdown)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_hint_004",
      mode: "create",
      multiMatchHint: "We found 3 projects matching 'AG1' - confirm the parent below.",
    });
    const block = findBlock(view, "multi_match_hint_block") as Block;
    expect(block.type).toBe("section");
    const text = (block.text as { type: string; text: string }).text;
    expect(text).toContain("*");
    expect((block.text as { type: string }).type).toBe("mrkdwn");
  });

  it("renders baseline as a context block (muted)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_hint_005",
      mode: "create",
      baselineHint: BASELINE_PARENT_PICKER_HINT,
    });
    const block = findBlock(view, "baseline_hint_block") as Block;
    expect(block.type).toBe("context");
  });

  it("renders the error block above all hints when errorBlock is provided", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_hint_006",
      mode: "create",
      baselineHint: BASELINE_PARENT_PICKER_HINT,
      multiMatchHint: "We found 3 projects matching 'AG1' - confirm the parent below.",
      errorBlock: { blockId: "validator_error_block", message: "Pick a parent project." },
    });
    const errIdx = indexOfBlock(view, "validator_error_block");
    const multiIdx = indexOfBlock(view, "multi_match_hint_block");
    const baselineIdx = indexOfBlock(view, "baseline_hint_block");
    const pickerIdx = indexOfBlock(view, "parent_project_block");
    expect(errIdx).toBeGreaterThan(-1);
    expect(errIdx).toBeLessThan(multiIdx);
    expect(multiIdx).toBeLessThan(baselineIdx);
    expect(baselineIdx).toBeLessThan(pickerIdx);
  });
});

// ---------------------------------------------------------------------------
// Multi-match candidate picker (slash-command /runway-edit-task disambiguation)
// ---------------------------------------------------------------------------
//
// When fuzzy match returns multiple candidates, the modal must surface them
// as a static_select picker so the user can pick the row to edit. Picking
// fires a block_actions event (handler is wired separately) which rebuilds
// the modal in post-pick state with currentValues populated from the picked
// entity. Once currentValues is set, the picker block disappears.

describe("buildTaskModal - multi-match candidate picker", () => {
  const candidates = [
    { id: "task_001", label: "Draft homepage hero" },
    { id: "task_002", label: "Draft homepage subhead" },
    { id: "task_003", label: "Draft homepage CTA" },
  ];

  it("renders the multi_match_candidate_block when candidates are set and currentValues is undefined", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_pick_001",
      mode: "edit",
      multiMatchHint: "We found 3 tasks matching 'Draft' - pick one below.",
      multiMatchCandidates: candidates,
    });
    const block = findBlock(view, "multi_match_candidate_block");
    expect(block).toBeDefined();
  });

  it("uses static_select with action_id 'multi_match_candidate_select' and dispatch_action: true", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_pick_002",
      mode: "edit",
      multiMatchCandidates: candidates,
    });
    const block = findBlock(view, "multi_match_candidate_block") as Block & {
      dispatch_action?: boolean;
    };
    expect(block.dispatch_action).toBe(true);
    const element = block.element as { type: string; action_id: string };
    expect(element.type).toBe("static_select");
    expect(element.action_id).toBe("multi_match_candidate_select");
  });

  it("renders one option per candidate with value=id and text.text=label", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_pick_003",
      mode: "edit",
      multiMatchCandidates: candidates,
    });
    const block = findBlock(view, "multi_match_candidate_block") as Block;
    const element = block.element as {
      options: Array<{ text: { text: string }; value: string }>;
    };
    expect(element.options).toHaveLength(3);
    expect(element.options[0].value).toBe("task_001");
    expect(element.options[0].text.text).toBe("Draft homepage hero");
    expect(element.options[1].value).toBe("task_002");
    expect(element.options[1].text.text).toBe("Draft homepage subhead");
    expect(element.options[2].value).toBe("task_003");
    expect(element.options[2].text.text).toBe("Draft homepage CTA");
  });

  it("positions the picker AFTER multi_match_hint_block and BEFORE client_block", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_pick_004",
      mode: "edit",
      multiMatchHint: "We found 3 tasks matching 'Draft' - pick one below.",
      multiMatchCandidates: candidates,
    });
    const hintIdx = indexOfBlock(view, "multi_match_hint_block");
    const pickerIdx = indexOfBlock(view, "multi_match_candidate_block");
    const clientIdx = indexOfBlock(view, "client_block");
    expect(hintIdx).toBeGreaterThan(-1);
    expect(pickerIdx).toBeGreaterThan(-1);
    expect(clientIdx).toBeGreaterThan(-1);
    expect(hintIdx).toBeLessThan(pickerIdx);
    expect(pickerIdx).toBeLessThan(clientIdx);
  });

  it("does NOT render the picker when currentValues is set (post-pick state)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_pick_005",
      mode: "edit",
      multiMatchCandidates: candidates,
      currentValues: { title: "Draft homepage hero" },
    });
    expect(findBlock(view, "multi_match_candidate_block")).toBeUndefined();
  });

  it("does NOT render the picker when candidates is empty", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_pick_006",
      mode: "edit",
      multiMatchCandidates: [],
    });
    expect(findBlock(view, "multi_match_candidate_block")).toBeUndefined();
  });

  it("does NOT render the picker when candidates is undefined", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_pick_007",
      mode: "edit",
    });
    expect(findBlock(view, "multi_match_candidate_block")).toBeUndefined();
  });

  it("caps options at the first 100 candidates when more are passed in", () => {
    const tooMany = Array.from({ length: 150 }, (_, i) => ({
      id: `task_${i.toString().padStart(3, "0")}`,
      label: `Candidate ${i}`,
    }));
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_pick_008",
      mode: "edit",
      multiMatchCandidates: tooMany,
    });
    const block = findBlock(view, "multi_match_candidate_block") as Block;
    const element = block.element as { options: Array<{ value: string }> };
    expect(element.options).toHaveLength(100);
    expect(element.options[0].value).toBe("task_000");
    expect(element.options[99].value).toBe("task_099");
  });

  it("truncates option labels longer than 75 chars to 72 chars + '...'", () => {
    const longLabel = "X".repeat(100);
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_pick_009",
      mode: "edit",
      multiMatchCandidates: [{ id: "task_long", label: longLabel }],
    });
    const block = findBlock(view, "multi_match_candidate_block") as Block;
    const element = block.element as {
      options: Array<{ text: { text: string } }>;
    };
    const optionText = element.options[0].text.text;
    expect(optionText.length).toBe(75);
    expect(optionText.endsWith("...")).toBe(true);
    expect(optionText.slice(0, 72)).toBe("X".repeat(72));
  });

  it("does NOT truncate option labels exactly 75 chars long", () => {
    const exact = "Y".repeat(75);
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_pick_010",
      mode: "edit",
      multiMatchCandidates: [{ id: "task_exact", label: exact }],
    });
    const block = findBlock(view, "multi_match_candidate_block") as Block;
    const element = block.element as {
      options: Array<{ text: { text: string } }>;
    };
    expect(element.options[0].text.text).toBe(exact);
  });

  // Wave 6 / Fix 6.6: each option ships with a `description` carrying the
  // last 8 chars of the entity id so two candidates with a 72-char shared
  // prefix don't render identically.
  it("Fix 6.6: each option carries a description with the last 8 chars of the id", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_desc_001",
      mode: "edit",
      multiMatchCandidates: [
        { id: "2a75b39dfeea4bc1a94a245e0", label: "Same Prefix Long Title" },
        { id: "9zfe8c12bc99a3deedb71a2c0", label: "Same Prefix Other Title" },
      ],
    });
    const block = findBlock(view, "multi_match_candidate_block") as Block;
    const element = block.element as {
      options: Array<{
        value: string;
        description?: { type: string; text: string };
      }>;
    };
    expect(element.options[0].description).toBeDefined();
    expect(element.options[0].description?.type).toBe("plain_text");
    expect(element.options[0].description?.text).toBe("...94a245e0");
    expect(element.options[1].description?.text).toBe("...db71a2c0");
  });

  it("Fix 6.6: option description handles ids 8 chars or shorter", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_mm_desc_002",
      mode: "edit",
      multiMatchCandidates: [{ id: "abc", label: "Short" }],
    });
    const block = findBlock(view, "multi_match_candidate_block") as Block;
    const element = block.element as {
      options: Array<{ description?: { text: string } }>;
    };
    // The recipe's "...{last 8 chars}" rule degrades to "...{full id}" when
    // the id is 8 chars or shorter. Slack option description max is 75 chars
    // so any short id fits with room to spare.
    expect(element.options[0].description?.text).toBe("...abc");
  });
});

// Wave 6 / Fix 6.5: disambiguation-phase header. When the modal opens for an
// edit flow with multi-match candidates and the user has not picked yet, the
// title says "Pick a task to edit" rather than "Edit task - " (empty name).
describe("buildTaskModal - Fix 6.5 disambiguation header", () => {
  it("renders 'Pick a task to edit' in disambiguation phase (edit mode, candidates set, no title picked)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_disambig_title",
      mode: "edit",
      multiMatchCandidates: [
        { id: "wi_a", label: "Task A" },
        { id: "wi_b", label: "Task B" },
      ],
    });
    expect(view.title.text).toBe("Pick a task to edit");
  });

  it("falls back to the entity-name header once the user has picked (truncated to 24 chars)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_picked_title",
      mode: "edit",
      multiMatchCandidates: [{ id: "wi_a", label: "Task A" }],
      currentValues: { title: "Short" },
    });
    expect(view.title.text).toBe("Edit task - Short");
  });

  it("create mode is unaffected by the disambiguation header (always 'New task')", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_create_title",
      mode: "create",
      multiMatchCandidates: [{ id: "wi_a", label: "Task A" }],
    });
    expect(view.title.text).toBe("New task");
  });
});

// ---------------------------------------------------------------------------
// Field types and conditional render
// ---------------------------------------------------------------------------

describe("buildTaskModal — field types", () => {
  it("uses external_select for the parent-project picker (typeahead)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_field_001",
      mode: "create",
    });
    const block = findBlock(view, "parent_project_block") as Block;
    const element = block.element as { type: string };
    expect(element.type).toBe("external_select");
  });

  it("uses datepicker for the primary date input", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_field_002",
      mode: "create",
    });
    const block = findBlock(view, "date_block") as Block;
    const element = block.element as { type: string };
    expect(element.type).toBe("datepicker");
  });

  it("uses radio_buttons for date type with Single-day and Range options", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_field_003",
      mode: "create",
    });
    const block = findBlock(view, "date_type_block") as Block;
    const element = block.element as { type: string; options: Array<{ value: string }> };
    expect(element.type).toBe("radio_buttons");
    const values = element.options.map((o) => o.value);
    expect(values).toContain("single");
    expect(values).toContain("range");
  });

  it("uses static_select for category with the v7 enum", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_field_004",
      mode: "create",
    });
    const block = findBlock(view, "category_block") as Block;
    const element = block.element as { type: string; options: Array<{ value: string }> };
    expect(element.type).toBe("static_select");
    const values = element.options.map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining([
        "delivery",
        "kickoff",
        "review",
        "approval",
        "deadline",
        "launch",
      ]),
    );
  });

  it("uses datepicker for the start_date input", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_field_005",
      mode: "create",
      currentValues: { dateType: "range" },
    });
    const block = findBlock(view, "start_date_block") as Block;
    const element = block.element as { type: string };
    expect(element.type).toBe("datepicker");
  });

  it("uses plain_text_input for title and notes", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_field_006",
      mode: "create",
    });
    const titleBlock = findBlock(view, "title_block") as Block;
    const titleEl = titleBlock.element as { type: string };
    expect(titleEl.type).toBe("plain_text_input");

    const notesBlock = findBlock(view, "notes_block") as Block;
    const notesEl = notesBlock.element as { type: string; multiline?: boolean };
    expect(notesEl.type).toBe("plain_text_input");
    expect(notesEl.multiline).toBe(true);
  });

  it("renders no free-text date input — only datepicker elements for date fields", () => {
    const single = buildTaskModal({
      args: {},
      proposalId: "prop_field_007a",
      mode: "create",
    });
    const dateBlock = findBlock(single, "date_block") as Block;
    expect((dateBlock.element as { type: string }).type).toBe("datepicker");

    const range = buildTaskModal({
      args: {},
      proposalId: "prop_field_007b",
      mode: "create",
      currentValues: { dateType: "range" },
    });
    const startBlock = findBlock(range, "start_date_block") as Block;
    const endBlock = findBlock(range, "end_date_block") as Block;
    expect((startBlock.element as { type: string }).type).toBe("datepicker");
    expect((endBlock.element as { type: string }).type).toBe("datepicker");
  });
});

// ---------------------------------------------------------------------------
// Range-toggle conditional visibility
// ---------------------------------------------------------------------------

describe("buildTaskModal — Range/Single-day toggle", () => {
  it("Single mode renders date_block and hides start/end", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_range_001",
      mode: "create",
    });
    expect(findBlock(view, "date_block")).toBeDefined();
    expect(findBlock(view, "start_date_block")).toBeUndefined();
    expect(findBlock(view, "end_date_block")).toBeUndefined();
  });

  it("Range mode renders start_date_block + end_date_block and hides date_block", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_range_002",
      mode: "create",
      currentValues: { dateType: "range" },
    });
    expect(findBlock(view, "date_block")).toBeUndefined();
    expect(findBlock(view, "start_date_block")).toBeDefined();
    expect(findBlock(view, "end_date_block")).toBeDefined();
  });

  it("renders start + end dates in edit mode when dateType=range", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_range_003",
      mode: "edit",
      currentValues: {
        title: "Range task",
        dateType: "range",
        startDate: "2026-05-04",
        endDate: "2026-05-10",
      },
    });
    const startBlock = findBlock(view, "start_date_block") as Block;
    const endBlock = findBlock(view, "end_date_block") as Block;
    expect((startBlock.element as { initial_date?: string }).initial_date).toBe(
      "2026-05-04",
    );
    expect((endBlock.element as { initial_date?: string }).initial_date).toBe(
      "2026-05-10",
    );
  });

  it("date_type radio fires dispatch_action for views.update toggle", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_range_004",
      mode: "create",
    });
    const radioBlock = findBlock(view, "date_type_block") as Block & {
      dispatch_action?: boolean;
    };
    expect(radioBlock.dispatch_action).toBe(true);
    expect((radioBlock.element as { action_id: string }).action_id).toBe(
      "date_type_radio",
    );
  });

  it("client_select fires dispatch_action so cascade handler can rewrite private_metadata", () => {
    // Issue 1: input-block external_select state.values does NOT propagate
    // into block_suggestion payloads, so the Parent picker's options-provider
    // cannot read clientId from state.values. dispatch_action fires
    // block_actions on Client pick; the handler rebuilds the modal with
    // clientId in private_metadata.
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_client_cascade_001",
      mode: "create",
    });
    const clientBlock = findBlock(view, "client_block") as Block & {
      dispatch_action?: boolean;
    };
    expect(clientBlock.dispatch_action).toBe(true);
    expect((clientBlock.element as { action_id: string }).action_id).toBe(
      "client_select",
    );
  });
});

// ---------------------------------------------------------------------------
// Resources repeater (max 10)
// ---------------------------------------------------------------------------

describe("buildTaskModal — resources repeater", () => {
  it("renders one empty resources row when none provided", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_res_001",
      mode: "create",
    });
    expect(findBlock(view, "resources_block_0")).toBeDefined();
    expect(findBlock(view, "resources_block_1")).toBeUndefined();
  });

  it("renders one row per resource entry up to the supplied length", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_res_002",
      mode: "edit",
      currentValues: {
        title: "Multi-resource task",
        resources: ["CW: Kathy", "AM: Jill", "Dev: Allison"],
      },
    });
    expect(findBlock(view, "resources_block_0")).toBeDefined();
    expect(findBlock(view, "resources_block_1")).toBeDefined();
    expect(findBlock(view, "resources_block_2")).toBeDefined();
    expect(findBlock(view, "resources_block_3")).toBeUndefined();
  });

  it("caps the resources repeater at 10 rows even when 12 are passed in", () => {
    const tooMany = Array.from({ length: 12 }, (_, i) => `Role: Person${i}`);
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_res_003",
      mode: "edit",
      currentValues: { title: "Capped resources", resources: tooMany },
    });
    expect(findBlock(view, "resources_block_9")).toBeDefined();
    expect(findBlock(view, "resources_block_10")).toBeUndefined();
    expect(findBlock(view, "resources_block_11")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cascade-deadline explainer
// ---------------------------------------------------------------------------

describe("buildTaskModal — cascade-deadline explainer", () => {
  it("does NOT render the explainer when category is delivery", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_cascade_001",
      mode: "create",
      currentValues: { category: "delivery" },
    });
    expect(findBlock(view, "cascade_deadline_explainer_block")).toBeUndefined();
  });

  it("renders the explainer as a context block when category=deadline", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_cascade_002",
      mode: "create",
      currentValues: { category: "deadline" },
    });
    const block = findBlock(view, "cascade_deadline_explainer_block") as Block;
    expect(block).toBeDefined();
    expect(block.type).toBe("context");
    const elements = block.elements as Array<{ type: string; text: string }>;
    const joined = elements.map((e) => e.text).join(" ");
    expect(joined).toContain(CASCADE_DEADLINE_EXPLAINER);
  });
});

// ---------------------------------------------------------------------------
// Slack hard-limits — title length + empty-options guards
// ---------------------------------------------------------------------------
//
// Reproduces the operator's 2026-04-30 manual-test failures:
//   1. view.title.text must be < 25 chars (Slack rejects with
//      "must be less than 25 characters" otherwise).
//   2. Every static_select / accessory `options` array must have at least 1
//      item (Slack rejects with "must provide at least 1 items" otherwise).
//      External_select does not require populated options.

/**
 * Walk the view recursively and yield every options array found on any
 * static_select-shaped element. Skips external_select (no static options)
 * and checkboxes (own constraint: needs >=1 option but has its own seed).
 */
function* walkStaticSelectOptionsArrays(
  obj: unknown,
): Generator<{ path: string; options: unknown[] }> {
  function* walk(node: unknown, path: string): Generator<{ path: string; options: unknown[] }> {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (
      rec.type === "static_select" &&
      Array.isArray(rec.options)
    ) {
      yield { path: `${path}.options`, options: rec.options };
    }
    for (const [k, v] of Object.entries(rec)) {
      if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
          yield* walk(v[i], `${path}.${k}[${i}]`);
        }
      } else if (v && typeof v === "object") {
        yield* walk(v, `${path}.${k}`);
      }
    }
  }
  yield* walk(obj, "$");
}

describe("buildTaskModal — Slack title-length guard (≤24 chars)", () => {
  it("create-mode title fits Slack's <25 char cap", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_title_001",
      mode: "create",
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
  });

  it("edit-mode title fits the cap with a short entity title", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_title_002",
      mode: "edit",
      currentValues: { title: "Hero" },
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
  });

  it("edit-mode title fits the cap with a 100-char entity title (truncation)", () => {
    const longTitle = "X".repeat(100);
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_title_003",
      mode: "edit",
      currentValues: { title: longTitle },
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.endsWith("...")).toBe(true);
  });
});

describe("buildTaskModal — Slack empty-options guard", () => {
  it("emits no static_select with an empty options array (default create render)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_options_001",
      mode: "create",
    });
    const offenders: string[] = [];
    for (const { path, options } of walkStaticSelectOptionsArrays(view)) {
      if (options.length === 0) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("emits no static_select with an empty options array (range mode + multi-row resources)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_options_002",
      mode: "edit",
      currentValues: {
        title: "Multi-row",
        dateType: "range",
        startDate: "2026-05-01",
        date: "2026-05-10",
        resources: ["CW: Kathy", "AM: Jill"],
      },
    });
    const offenders: string[] = [];
    for (const { path, options } of walkStaticSelectOptionsArrays(view)) {
      if (options.length === 0) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Source-level grep guard — task.ts itself must obey Civ-voice rules
// ---------------------------------------------------------------------------

describe("source-level grep guard on task.ts", () => {
  const sourcePath = path.join(__dirname, "task.ts");
  const source = fs.readFileSync(sourcePath, "utf8");

  it("contains zero em-dash characters (U+2014)", () => {
    expect(source.includes("\u2014")).toBe(false);
  });

  it("contains zero en-dash characters (U+2013)", () => {
    expect(source.includes("\u2013")).toBe(false);
  });

  it("contains zero L1 or L2 tokens in user-facing string literals", () => {
    // Strip line comments and block comments before scanning so the test
    // policy 'no L1/L2 in user-facing strings' is enforced literally on the
    // strings themselves, while comments may explain context if needed.
    const noLineComments = source.replace(/\/\/.*$/gm, "");
    const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(noBlockComments.match(/\bL[12]\b/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bug A: Client and Parent project picker initial_option labels.
//
// initial_option.value carries the FK column id (clientId / projectId).
// initial_option.text MUST carry the human-readable name when currentValues
// supplies clientName / projectName. Pre-fix, both fields used the id which
// caused users to see "f0d5a9b9..." instead of "AG1" after a multi-match pick.
// ---------------------------------------------------------------------------

describe("buildTaskModal — Bug A: picker initial_option labels", () => {
  it("client_block initial_option uses clientName for the label when provided", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_bug_a_client_001",
      mode: "edit",
      currentValues: {
        title: "Edit me",
        clientId: "f0d5a9b931404d90bd6e84346",
        clientName: "AG1",
      },
    });
    const block = findBlock(view, "client_block") as Block;
    const element = block.element as {
      initial_option?: { value?: string; text?: { text?: string } };
    };
    expect(element.initial_option?.value).toBe("f0d5a9b931404d90bd6e84346");
    expect(element.initial_option?.text?.text).toBe("AG1");
  });

  it("client_block falls back to clientId for label when clientName missing (legacy edit shape)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_bug_a_client_002",
      mode: "edit",
      currentValues: {
        title: "Edit me",
        clientId: "client_legacy_id",
      },
    });
    const block = findBlock(view, "client_block") as Block;
    const element = block.element as {
      initial_option?: { value?: string; text?: { text?: string } };
    };
    expect(element.initial_option?.value).toBe("client_legacy_id");
    expect(element.initial_option?.text?.text).toBe("client_legacy_id");
  });

  it("parent_project_block initial_option uses projectName for the label when provided", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_bug_a_proj_001",
      mode: "edit",
      currentValues: {
        title: "Edit me",
        projectId: "affaaf0be5d94dcfb66dd7654",
        projectName: "TEST Retainer Verify",
      },
    });
    const block = findBlock(view, "parent_project_block") as Block;
    const element = block.element as {
      initial_option?: { value?: string; text?: { text?: string } };
    };
    expect(element.initial_option?.value).toBe("affaaf0be5d94dcfb66dd7654");
    expect(element.initial_option?.text?.text).toBe("TEST Retainer Verify");
  });

  it("parent_project_block falls back to projectId for label when projectName missing", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_bug_a_proj_002",
      mode: "edit",
      currentValues: {
        title: "Edit me",
        projectId: "proj_legacy_id",
      },
    });
    const block = findBlock(view, "parent_project_block") as Block;
    const element = block.element as {
      initial_option?: { value?: string; text?: { text?: string } };
    };
    expect(element.initial_option?.value).toBe("proj_legacy_id");
    expect(element.initial_option?.text?.text).toBe("proj_legacy_id");
  });
});
