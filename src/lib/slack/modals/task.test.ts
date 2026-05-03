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
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_field_007",
      mode: "create",
      currentValues: { dateType: "range" },
    });
    // Both date_block and start_date_block must use datepicker, not text input.
    const dateBlock = findBlock(view, "date_block") as Block;
    const startBlock = findBlock(view, "start_date_block") as Block;
    expect((dateBlock.element as { type: string }).type).toBe("datepicker");
    expect((startBlock.element as { type: string }).type).toBe("datepicker");
  });
});

// ---------------------------------------------------------------------------
// Range-toggle conditional visibility
// ---------------------------------------------------------------------------

describe("buildTaskModal — Range/Single-day toggle", () => {
  it("hides start_date_block when dateType is single (default)", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_range_001",
      mode: "create",
    });
    expect(findBlock(view, "start_date_block")).toBeUndefined();
  });

  it("renders start_date_block when dateType=range via currentValues", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_range_002",
      mode: "create",
      currentValues: { dateType: "range" },
    });
    expect(findBlock(view, "start_date_block")).toBeDefined();
  });

  it("renders start_date_block in edit mode when dateType=range", () => {
    const view = buildTaskModal({
      args: {},
      proposalId: "prop_range_003",
      mode: "edit",
      currentValues: {
        title: "Range task",
        dateType: "range",
        date: "2026-05-10",
        startDate: "2026-05-04",
      },
    });
    const block = findBlock(view, "start_date_block") as Block;
    const element = block.element as { initial_date?: string };
    expect(element.initial_date).toBe("2026-05-04");
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
