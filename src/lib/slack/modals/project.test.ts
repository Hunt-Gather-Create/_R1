/**
 * Tests for buildProjectModal — the Project modal view builder (create + edit)
 * with the Modal 3 retainer-checkbox conditional collapsed into a single
 * builder per pre-plan v7 §B6.
 *
 * Spec sources (locked):
 *   - docs/tmp/slack-modal-pre-plan.md (v7) — §"Modal flows" (line 376),
 *     §A3 hint render order, §B5 datepicker-only dates, §B6 single Project
 *     builder, §C3 mode/currentValues + edit headers
 *   - project_slack_modal_spec.md (Modal 2 + Modal 3 field design)
 *
 * What the builder must do:
 *   - Header swap across all 4 mode×retainerMode combos:
 *       create + !retainerMode → MODAL_HEADERS.newProject
 *       create + retainerMode  → MODAL_HEADERS.newRetainer
 *       edit   + !retainerMode → MODAL_HEADERS.editProject(currentValues.name)
 *       edit   + retainerMode  → MODAL_HEADERS.editRetainer(currentValues.name)
 *   - callback_id: runway_new_project (create) | runway_edit_project (edit)
 *   - private_metadata: JSON.stringify({ proposalId, retainerMode })
 *   - retainerMode=false:
 *       - render is_retainer checkbox (initial_options reflects retainerMode)
 *       - render engagementType radio (Project / Break-fix)
 *       - render multiMatchHint (when present) ABOVE baselineHint (when present)
 *         ABOVE the parent retainer picker; both above the picker block
 *       - render parent retainer external_select picker
 *       - do NOT render contract date inputs
 *   - retainerMode=true:
 *       - render is_retainer checkbox (checked)
 *       - render engagementType as a read-only context block ("Retainer (locked)")
 *       - do NOT render parent retainer picker
 *       - do NOT render any hint blocks (multiMatch/baseline are suppressed)
 *       - render contractStart + contractEnd datepickers
 *   - All date inputs use `datepicker` (no free-text — v7 §B5)
 *   - Resources repeater capped at 10 rows
 *
 * `buildEphemeralRetainerToggle(payload)` converts a block_actions
 * checkbox-toggle event into a `response_action: "update"` payload that
 * re-renders with the opposite retainerMode while preserving user-typed
 * values via initial_value propagation (Wave 8 #33 pattern).
 *
 * Source-level grep guard ensures project.ts contains no em-dashes or
 * tier-letter shorthand in user-facing strings.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  type BuildProjectModalParams,
  buildEphemeralRetainerToggle,
  buildProjectModal,
} from "./project";
import { BASELINE_PARENT_PICKER_HINT, formatMultiMatchHint } from "./copy";

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

function basicCreate(retainerMode: boolean): BuildProjectModalParams {
  return {
    args: {},
    proposalId: `prop_create_${retainerMode ? "ret" : "proj"}_001`,
    mode: "create",
    retainerMode,
  };
}

// ---------------------------------------------------------------------------
// Header / shell
// ---------------------------------------------------------------------------

describe("buildProjectModal — shell (create, project mode)", () => {
  it("renders the create+project header verbatim", () => {
    const view = buildProjectModal(basicCreate(false));
    expect(view.title.text).toBe("New project");
  });

  it("uses callback_id 'runway_new_project' in create mode", () => {
    const view = buildProjectModal(basicCreate(false));
    expect(view.callback_id).toBe("runway_new_project");
  });

  it("serializes proposalId AND retainerMode into private_metadata", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_abc_123",
      mode: "create",
      retainerMode: false,
    });
    const meta = JSON.parse(view.private_metadata);
    expect(meta.proposalId).toBe("prop_abc_123");
    expect(meta.retainerMode).toBe(false);
  });

  it("emits 'Save' submit and 'Cancel' close labels", () => {
    const view = buildProjectModal(basicCreate(false));
    expect(view.submit?.text).toBe("Save");
    expect(view.close?.text).toBe("Cancel");
  });

  it("declares modal type and notify_on_close so view_closed fires on cancel", () => {
    const view = buildProjectModal(basicCreate(false));
    expect(view.type).toBe("modal");
    expect(view.notify_on_close).toBe(true);
  });
});

describe("buildProjectModal — shell (create, retainer mode)", () => {
  it("renders the create+retainer header verbatim", () => {
    const view = buildProjectModal(basicCreate(true));
    expect(view.title.text).toBe("New retainer");
  });

  it("keeps callback_id 'runway_new_project' even in retainer mode", () => {
    // Per spec line 376: callback_id is `runway_new_project`; retainer flag
    // travels in private_metadata. The same Inngest submit handler branches
    // on the is_retainer checkbox state.
    const view = buildProjectModal(basicCreate(true));
    expect(view.callback_id).toBe("runway_new_project");
  });

  it("encodes retainerMode=true into private_metadata", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_ret_999",
      mode: "create",
      retainerMode: true,
    });
    const meta = JSON.parse(view.private_metadata);
    expect(meta.retainerMode).toBe(true);
    expect(meta.proposalId).toBe("prop_ret_999");
  });
});

describe("buildProjectModal — shell (edit, project mode)", () => {
  it("renders 'Edit project - {name}' header verbatim when it fits the 24-char cap", () => {
    // "Edit project - Hero" is 19 chars, fits under Slack's title cap.
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_proj_001",
      mode: "edit",
      retainerMode: false,
      currentValues: { name: "Hero" },
    });
    expect(view.title.text).toBe("Edit project - Hero");
  });

  it("truncates 'Edit project - {name}' with an ellipsis when the full string overflows", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_proj_001b",
      mode: "edit",
      retainerMode: false,
      currentValues: { name: "AG1 Q2 Brand Refresh" },
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.startsWith("Edit project - ")).toBe(true);
    expect(view.title.text.endsWith("...")).toBe(true);
  });

  it("uses callback_id 'runway_edit_project' in edit mode", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_proj_002",
      mode: "edit",
      retainerMode: false,
      currentValues: { name: "Whatever" },
    });
    expect(view.callback_id).toBe("runway_edit_project");
  });

  it("truncates the edit header to Slack's 24-char title cap with an ellipsis", () => {
    const longName = "An Extremely Long Project Name That Will Not Fit At All";
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_proj_003",
      mode: "edit",
      retainerMode: false,
      currentValues: { name: longName },
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.endsWith("...")).toBe(true);
  });

  it("falls back to a stable header when currentValues.name is missing", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_proj_004",
      mode: "edit",
      retainerMode: false,
    });
    expect(view.title.text).toMatch(/^Edit project/);
    expect(view.title.text.length).toBeLessThanOrEqual(24);
  });
});

describe("buildProjectModal — shell (edit, retainer mode)", () => {
  it("renders 'Edit retainer - {name}' header verbatim when it fits the 24-char cap", () => {
    // "Edit retainer - X" is 17 chars; "Edit retainer - Pro" is 19 chars.
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_ret_001",
      mode: "edit",
      retainerMode: true,
      currentValues: { name: "Pro" },
    });
    expect(view.title.text).toBe("Edit retainer - Pro");
  });

  it("truncates 'Edit retainer - {name}' with an ellipsis when the full string overflows", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_ret_001b",
      mode: "edit",
      retainerMode: true,
      currentValues: { name: "AG1 Pro 2026 Wrapper" },
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.startsWith("Edit retainer - ")).toBe(true);
    expect(view.title.text.endsWith("...")).toBe(true);
  });

  it("uses callback_id 'runway_edit_project' in edit mode (retainer too)", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_ret_002",
      mode: "edit",
      retainerMode: true,
      currentValues: { name: "X" },
    });
    expect(view.callback_id).toBe("runway_edit_project");
  });
});

// ---------------------------------------------------------------------------
// Conditional layout — retainerMode=false (project)
// ---------------------------------------------------------------------------

describe("buildProjectModal — layout (retainerMode=false)", () => {
  it("renders the is_retainer checkbox with retainerMode=false reflected in initial_options", () => {
    const view = buildProjectModal(basicCreate(false));
    const cb = findBlock(view, "is_retainer_block") as Block;
    expect(cb).toBeDefined();
    const element = cb.element as {
      type: string;
      action_id: string;
      initial_options?: Array<unknown>;
      options: Array<unknown>;
    };
    expect(element.type).toBe("checkboxes");
    expect(element.action_id).toBe("is_retainer_checkbox");
    // off → no initial_options (or empty array)
    expect(element.initial_options ?? []).toHaveLength(0);
  });

  it("renders the is_retainer checkbox block with dispatch_action so toggles fire block_actions", () => {
    const view = buildProjectModal(basicCreate(false));
    const cb = findBlock(view, "is_retainer_block") as Block;
    expect(cb.dispatch_action).toBe(true);
  });

  it("renders the engagementType radio (Project / Break-fix), NOT a context block", () => {
    const view = buildProjectModal(basicCreate(false));
    const block = findBlock(view, "engagement_type_block") as Block;
    expect(block).toBeDefined();
    expect(block.type).toBe("input");
    const element = block.element as {
      type: string;
      options: Array<{ value: string; text: { text: string } }>;
    };
    expect(element.type).toBe("radio_buttons");
    const values = element.options.map((o) => o.value);
    expect(values).toEqual(["project", "break-fix"]);
  });

  it("renders the parent retainer picker (external_select)", () => {
    const view = buildProjectModal(basicCreate(false));
    const block = findBlock(view, "parent_retainer_block") as Block;
    expect(block).toBeDefined();
    const element = block.element as { type: string; action_id: string };
    expect(element.type).toBe("external_select");
    expect(element.action_id).toBe("parent_retainer_picker");
  });

  it("does NOT render contract date inputs in project mode", () => {
    const view = buildProjectModal(basicCreate(false));
    expect(findBlock(view, "contract_start_block")).toBeUndefined();
    expect(findBlock(view, "contract_end_block")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Conditional layout — retainerMode=true (retainer)
// ---------------------------------------------------------------------------

describe("buildProjectModal — layout (retainerMode=true)", () => {
  it("renders the is_retainer checkbox in checked state", () => {
    const view = buildProjectModal(basicCreate(true));
    const cb = findBlock(view, "is_retainer_block") as Block;
    expect(cb).toBeDefined();
    const element = cb.element as {
      type: string;
      action_id: string;
      initial_options?: Array<{ value: string }>;
      options: Array<{ value: string }>;
    };
    expect(element.action_id).toBe("is_retainer_checkbox");
    expect(element.initial_options).toBeDefined();
    expect(element.initial_options?.[0]?.value).toBe("is_retainer");
  });

  it("renders engagementType as a read-only context block, NOT a radio", () => {
    const view = buildProjectModal(basicCreate(true));
    const block = findBlock(view, "engagement_type_block") as Block;
    expect(block).toBeDefined();
    expect(block.type).toBe("context");
    const elements = block.elements as Array<{ type: string; text?: string }>;
    expect(elements[0]?.type).toBe("mrkdwn");
    expect(elements[0]?.text).toContain("Retainer");
    expect(elements[0]?.text).toContain("locked");
  });

  it("does NOT render the parent retainer picker", () => {
    const view = buildProjectModal(basicCreate(true));
    expect(findBlock(view, "parent_retainer_block")).toBeUndefined();
  });

  it("renders contract_start and contract_end datepickers", () => {
    const view = buildProjectModal(basicCreate(true));
    const cs = findBlock(view, "contract_start_block") as Block;
    const ce = findBlock(view, "contract_end_block") as Block;
    expect(cs).toBeDefined();
    expect(ce).toBeDefined();
    expect((cs.element as { type: string }).type).toBe("datepicker");
    expect((ce.element as { type: string }).type).toBe("datepicker");
  });
});

// ---------------------------------------------------------------------------
// Hint render coverage (v7 §A3)
// ---------------------------------------------------------------------------

describe("buildProjectModal — hint render (retainerMode=false)", () => {
  it("renders only the picker when neither hint is provided", () => {
    const view = buildProjectModal(basicCreate(false));
    expect(findBlock(view, "multi_match_hint_block")).toBeUndefined();
    expect(findBlock(view, "baseline_hint_block")).toBeUndefined();
    expect(findBlock(view, "parent_retainer_block")).toBeDefined();
  });

  it("renders baseline alone above the picker", () => {
    const view = buildProjectModal({
      ...basicCreate(false),
      baselineHint: BASELINE_PARENT_PICKER_HINT,
    });
    expect(findBlock(view, "multi_match_hint_block")).toBeUndefined();
    const baseline = findBlock(view, "baseline_hint_block") as Block;
    expect(baseline).toBeDefined();
    expect(baseline.type).toBe("context");
    const baselineIdx = indexOfBlock(view, "baseline_hint_block");
    const pickerIdx = indexOfBlock(view, "parent_retainer_block");
    expect(baselineIdx).toBeGreaterThanOrEqual(0);
    expect(baselineIdx).toBeLessThan(pickerIdx);
  });

  it("renders multi-match + baseline + picker in spec order", () => {
    const view = buildProjectModal({
      ...basicCreate(false),
      baselineHint: BASELINE_PARENT_PICKER_HINT,
      multiMatchHint: formatMultiMatchHint(3, "AG1", "retainer"),
    });
    const mIdx = indexOfBlock(view, "multi_match_hint_block");
    const bIdx = indexOfBlock(view, "baseline_hint_block");
    const pIdx = indexOfBlock(view, "parent_retainer_block");
    expect(mIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(mIdx);
    expect(pIdx).toBeGreaterThan(bIdx);
  });

  it("multi-match hint uses bold/emphasis (mrkdwn *...*) in a section block", () => {
    const view = buildProjectModal({
      ...basicCreate(false),
      multiMatchHint: formatMultiMatchHint(2, "AG1", "retainer"),
    });
    const m = findBlock(view, "multi_match_hint_block") as Block;
    expect(m.type).toBe("section");
    const text = (m.text as { type: string; text: string }).text;
    expect(text.startsWith("*") && text.endsWith("*")).toBe(true);
  });

  it("baseline hint is a `context` block (muted)", () => {
    const view = buildProjectModal({
      ...basicCreate(false),
      baselineHint: BASELINE_PARENT_PICKER_HINT,
    });
    const b = findBlock(view, "baseline_hint_block") as Block;
    expect(b.type).toBe("context");
  });
});

describe("buildProjectModal — hint render (retainerMode=true)", () => {
  it("suppresses BOTH hints in retainer mode regardless of input", () => {
    const view = buildProjectModal({
      ...basicCreate(true),
      baselineHint: BASELINE_PARENT_PICKER_HINT,
      multiMatchHint: formatMultiMatchHint(3, "AG1", "retainer"),
    });
    expect(findBlock(view, "multi_match_hint_block")).toBeUndefined();
    expect(findBlock(view, "baseline_hint_block")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Edit-mode pre-fill
// ---------------------------------------------------------------------------

describe("buildProjectModal — edit pre-fill (project mode)", () => {
  const currentValues = {
    name: "AG1 Q2 Brand Refresh",
    clientId: "client_ag1",
    engagementType: "project",
    parentProjectId: "proj_ag1_pro_2026",
    status: "in-production",
    category: "active",
    owner: "tm_kathy",
    resources: ["CW: Kathy", "Dev: Andrew"],
    startDate: "2026-05-01",
    endDate: "2026-06-30",
    dueDate: "2026-06-30",
    notes: "Hero refresh + tone alignment.",
  };

  it("propagates name into the project_name input's initial_value", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_pf_001",
      mode: "edit",
      retainerMode: false,
      currentValues,
    });
    const block = findBlock(view, "project_name_block") as Block;
    const element = block.element as { initial_value?: string };
    expect(element.initial_value).toBe("AG1 Q2 Brand Refresh");
  });

  it("propagates startDate into the start_date_block datepicker", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_pf_002",
      mode: "edit",
      retainerMode: false,
      currentValues,
    });
    const block = findBlock(view, "start_date_block") as Block;
    const element = block.element as { initial_date?: string };
    expect(element.initial_date).toBe("2026-05-01");
  });

  it("propagates endDate and dueDate into their respective datepickers", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_pf_003",
      mode: "edit",
      retainerMode: false,
      currentValues,
    });
    const ed = findBlock(view, "end_date_block") as Block;
    const dd = findBlock(view, "due_date_block") as Block;
    expect((ed.element as { initial_date?: string }).initial_date).toBe(
      "2026-06-30",
    );
    expect((dd.element as { initial_date?: string }).initial_date).toBe(
      "2026-06-30",
    );
  });

  it("propagates engagementType into the radio's initial_option", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_pf_004",
      mode: "edit",
      retainerMode: false,
      currentValues,
    });
    const block = findBlock(view, "engagement_type_block") as Block;
    const element = block.element as { initial_option?: { value?: string } };
    expect(element.initial_option?.value).toBe("project");
  });

  it("propagates status and category into static_select initial_options", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_pf_005",
      mode: "edit",
      retainerMode: false,
      currentValues,
    });
    const sb = findBlock(view, "status_block") as Block;
    const cb = findBlock(view, "category_block") as Block;
    expect((sb.element as { initial_option?: { value?: string } }).initial_option?.value).toBe(
      "in-production",
    );
    expect((cb.element as { initial_option?: { value?: string } }).initial_option?.value).toBe(
      "active",
    );
  });

  it("renders one resources row per element, capped at 10", () => {
    const longList = Array.from({ length: 14 }, (_, i) => `CW: Person${i}`);
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_pf_006",
      mode: "edit",
      retainerMode: false,
      currentValues: { ...currentValues, resources: longList },
    });
    // Count role accessory blocks. Each row has a role + name block.
    const roleBlocks = view.blocks.filter(
      (b) => typeof b.block_id === "string" && b.block_id.startsWith("resources_block_"),
    );
    expect(roleBlocks.length).toBeLessThanOrEqual(10);
    expect(roleBlocks.length).toBe(10);
  });

  it("propagates notes into notes_block initial_value", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_pf_007",
      mode: "edit",
      retainerMode: false,
      currentValues,
    });
    const block = findBlock(view, "notes_block") as Block;
    expect((block.element as { initial_value?: string }).initial_value).toBe(
      currentValues.notes,
    );
  });
});

describe("buildProjectModal — edit pre-fill (retainer mode)", () => {
  const currentValues = {
    name: "AG1 Pro 2026",
    clientId: "client_ag1",
    engagementType: "retainer",
    status: "in-production",
    category: "active",
    owner: "tm_kathy",
    resources: ["CW: Kathy"],
    contractStart: "2026-01-01",
    contractEnd: "2026-12-31",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    notes: "Retainer wrapper.",
  };

  it("renders the retainer edit header truncated when the full name overflows the 24-char cap", () => {
    // "AG1 Pro 2026" is 12 chars; full header "Edit retainer - AG1 Pro 2026"
    // is 28 chars. Slack caps at 24, so the builder ellipsis-truncates.
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_pf_ret_001",
      mode: "edit",
      retainerMode: true,
      currentValues,
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.startsWith("Edit retainer - ")).toBe(true);
    expect(view.title.text.endsWith("...")).toBe(true);
  });

  it("propagates contractStart and contractEnd into datepickers", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_pf_ret_002",
      mode: "edit",
      retainerMode: true,
      currentValues,
    });
    const cs = findBlock(view, "contract_start_block") as Block;
    const ce = findBlock(view, "contract_end_block") as Block;
    expect((cs.element as { initial_date?: string }).initial_date).toBe(
      "2026-01-01",
    );
    expect((ce.element as { initial_date?: string }).initial_date).toBe(
      "2026-12-31",
    );
  });

  it("does NOT render the parent retainer picker even in edit mode", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_edit_pf_ret_003",
      mode: "edit",
      retainerMode: true,
      currentValues,
    });
    expect(findBlock(view, "parent_retainer_block")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Datepicker-only dates (v7 §B5)
// ---------------------------------------------------------------------------

describe("buildProjectModal — datepicker-only dates", () => {
  it("uses datepicker for every date field in project mode", () => {
    const view = buildProjectModal(basicCreate(false));
    const fields = ["start_date_block", "end_date_block", "due_date_block"];
    for (const id of fields) {
      const block = findBlock(view, id) as Block;
      expect(block).toBeDefined();
      expect((block.element as { type: string }).type).toBe("datepicker");
    }
  });

  it("uses datepicker for every date field in retainer mode (incl. contract dates)", () => {
    const view = buildProjectModal(basicCreate(true));
    const fields = [
      "start_date_block",
      "end_date_block",
      "due_date_block",
      "contract_start_block",
      "contract_end_block",
    ];
    for (const id of fields) {
      const block = findBlock(view, id) as Block;
      expect(block).toBeDefined();
      expect((block.element as { type: string }).type).toBe("datepicker");
    }
  });
});

// ---------------------------------------------------------------------------
// Error block (Phase 2/3 will pass)
// ---------------------------------------------------------------------------

describe("buildProjectModal — errorBlock", () => {
  it("renders the error block above the rest of the form when present", () => {
    const view = buildProjectModal({
      ...basicCreate(false),
      errorBlock: {
        blockId: "validation_error",
        message:
          "Status `completed` can't pair with category `active`. Pick `completed` for the category, or change the status.",
      },
    });
    const idx = indexOfBlock(view, "validation_error");
    expect(idx).toBeGreaterThanOrEqual(0);
    // Below the client picker, above the project name.
    const clientIdx = indexOfBlock(view, "client_block");
    const nameIdx = indexOfBlock(view, "project_name_block");
    expect(idx).toBeGreaterThan(clientIdx);
    expect(idx).toBeLessThan(nameIdx);
  });

  it("omits the error block when not provided", () => {
    const view = buildProjectModal(basicCreate(false));
    expect(findBlock(view, "validation_error")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildEphemeralRetainerToggle — checkbox toggle re-render with value preservation
// ---------------------------------------------------------------------------

describe("buildEphemeralRetainerToggle — off → on", () => {
  // Realistic block_actions payload shape from Slack. Only the fields the
  // helper actually reads are populated; the rest are noise the helper must
  // tolerate.
  function offToOnPayload() {
    return {
      type: "block_actions" as const,
      trigger_id: "trigger_xxx",
      view: {
        id: "V12345",
        callback_id: "runway_new_project",
        private_metadata: JSON.stringify({
          proposalId: "prop_toggle_001",
          retainerMode: false,
        }),
        state: {
          values: {
            project_name_block: {
              project_name_input: { type: "plain_text_input", value: "AG1 Pro 2026" },
            },
            is_retainer_block: {
              is_retainer_checkbox: {
                type: "checkboxes",
                // The toggle that just fired - now ON.
                selected_options: [{ value: "is_retainer" }],
              },
            },
          },
        },
      },
      actions: [
        {
          action_id: "is_retainer_checkbox",
          type: "checkboxes",
          selected_options: [{ value: "is_retainer" }],
        },
      ],
    };
  }

  it("returns response_action='update' with a fresh modal view", () => {
    const out = buildEphemeralRetainerToggle(offToOnPayload());
    expect(out.response_action).toBe("update");
    expect(out.view.type).toBe("modal");
  });

  it("flips retainerMode to true in the new view's private_metadata", () => {
    const out = buildEphemeralRetainerToggle(offToOnPayload());
    const meta = JSON.parse(out.view.private_metadata);
    expect(meta.retainerMode).toBe(true);
    expect(meta.proposalId).toBe("prop_toggle_001");
  });

  it("swaps the header to the new-retainer string", () => {
    const out = buildEphemeralRetainerToggle(offToOnPayload());
    expect(out.view.title.text).toBe("New retainer");
  });

  it("removes the parent retainer picker after flipping ON", () => {
    const out = buildEphemeralRetainerToggle(offToOnPayload());
    const blocks = out.view.blocks as Block[];
    expect(blocks.find((b) => b.block_id === "parent_retainer_block")).toBeUndefined();
  });

  it("adds contract start + contract end datepickers after flipping ON", () => {
    const out = buildEphemeralRetainerToggle(offToOnPayload());
    const blocks = out.view.blocks as Block[];
    expect(blocks.find((b) => b.block_id === "contract_start_block")).toBeDefined();
    expect(blocks.find((b) => b.block_id === "contract_end_block")).toBeDefined();
  });

  it("preserves the user-typed project name across re-render", () => {
    const out = buildEphemeralRetainerToggle(offToOnPayload());
    const blocks = out.view.blocks as Block[];
    const nameBlock = blocks.find((b) => b.block_id === "project_name_block") as Block;
    expect((nameBlock.element as { initial_value?: string }).initial_value).toBe(
      "AG1 Pro 2026",
    );
  });
});

describe("buildEphemeralRetainerToggle — on → off", () => {
  function onToOffPayload() {
    return {
      type: "block_actions" as const,
      trigger_id: "trigger_yyy",
      view: {
        id: "V67890",
        callback_id: "runway_new_project",
        private_metadata: JSON.stringify({
          proposalId: "prop_toggle_002",
          retainerMode: true,
        }),
        state: {
          values: {
            project_name_block: {
              project_name_input: { type: "plain_text_input", value: "Half-typed name" },
            },
            is_retainer_block: {
              is_retainer_checkbox: {
                type: "checkboxes",
                // Toggle now OFF.
                selected_options: [],
              },
            },
          },
        },
      },
      actions: [
        {
          action_id: "is_retainer_checkbox",
          type: "checkboxes",
          selected_options: [],
        },
      ],
    };
  }

  it("flips retainerMode to false in the new view's private_metadata", () => {
    const out = buildEphemeralRetainerToggle(onToOffPayload());
    const meta = JSON.parse(out.view.private_metadata);
    expect(meta.retainerMode).toBe(false);
  });

  it("swaps the header back to the new-project string", () => {
    const out = buildEphemeralRetainerToggle(onToOffPayload());
    expect(out.view.title.text).toBe("New project");
  });

  it("removes contract start + contract end datepickers after flipping OFF", () => {
    const out = buildEphemeralRetainerToggle(onToOffPayload());
    const blocks = out.view.blocks as Block[];
    expect(blocks.find((b) => b.block_id === "contract_start_block")).toBeUndefined();
    expect(blocks.find((b) => b.block_id === "contract_end_block")).toBeUndefined();
  });

  it("restores the parent retainer picker AND the baseline hint after flipping OFF", () => {
    const out = buildEphemeralRetainerToggle(onToOffPayload());
    const blocks = out.view.blocks as Block[];
    expect(blocks.find((b) => b.block_id === "parent_retainer_block")).toBeDefined();
    expect(blocks.find((b) => b.block_id === "baseline_hint_block")).toBeDefined();
  });

  it("preserves the user-typed project name even when flipping OFF", () => {
    const out = buildEphemeralRetainerToggle(onToOffPayload());
    const blocks = out.view.blocks as Block[];
    const nameBlock = blocks.find((b) => b.block_id === "project_name_block") as Block;
    expect((nameBlock.element as { initial_value?: string }).initial_value).toBe(
      "Half-typed name",
    );
  });
});

// ---------------------------------------------------------------------------
// Slack hard-limits — title length + empty-options guards
// ---------------------------------------------------------------------------

function* walkStaticSelectOptionsArrays(
  obj: unknown,
): Generator<{ path: string; options: unknown[] }> {
  function* walk(node: unknown, path: string): Generator<{ path: string; options: unknown[] }> {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    if (rec.type === "static_select" && Array.isArray(rec.options)) {
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

describe("buildProjectModal — Slack title-length guard (≤24 chars)", () => {
  it("create+project title fits the cap", () => {
    const view = buildProjectModal(basicCreate(false));
    expect(view.title.text.length).toBeLessThanOrEqual(24);
  });

  it("create+retainer title fits the cap", () => {
    const view = buildProjectModal(basicCreate(true));
    expect(view.title.text.length).toBeLessThanOrEqual(24);
  });

  it("edit+project with 100-char name fits the cap (truncation)", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_title_001",
      mode: "edit",
      retainerMode: false,
      currentValues: { name: "X".repeat(100) },
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.endsWith("...")).toBe(true);
  });

  it("edit+retainer with 100-char name fits the cap (truncation)", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_title_002",
      mode: "edit",
      retainerMode: true,
      currentValues: { name: "X".repeat(100) },
    });
    expect(view.title.text.length).toBeLessThanOrEqual(24);
    expect(view.title.text.endsWith("...")).toBe(true);
  });
});

describe("buildProjectModal — Slack empty-options guard", () => {
  it("emits no empty static_select options array (project mode default render)", () => {
    const view = buildProjectModal(basicCreate(false));
    const offenders: string[] = [];
    for (const { path, options } of walkStaticSelectOptionsArrays(view)) {
      if (options.length === 0) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("emits no empty static_select options array (retainer mode default render)", () => {
    const view = buildProjectModal(basicCreate(true));
    const offenders: string[] = [];
    for (const { path, options } of walkStaticSelectOptionsArrays(view)) {
      if (options.length === 0) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  it("emits no empty static_select options array (multi-row resources edit)", () => {
    const view = buildProjectModal({
      args: {},
      proposalId: "prop_options_001",
      mode: "edit",
      retainerMode: false,
      currentValues: {
        name: "Multi-row",
        resources: ["CW: Kathy", "AM: Jill", "Dev: Andrew"],
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
// Source-level grep guard — no em-dashes, no L1/L2 tokens in user-facing strings
// ---------------------------------------------------------------------------

describe("source-level grep guard on project.ts", () => {
  const sourcePath = path.join(__dirname, "project.ts");
  const source = fs.readFileSync(sourcePath, "utf8");

  it("contains zero em-dash characters (U+2014) in non-comment lines", () => {
    // Em-dashes are banned in user-facing copy. Comments may use ASCII hyphens
    // (and do, in this file's header). We only assert the absence of em-dashes
    // anywhere in the source — the strict version of the rule.
    expect(source.includes("\u2014")).toBe(false);
  });

  it("contains zero `\\bL[12]\\b` tokens in user-facing strings", () => {
    // The rule per pre-plan v7: no L1/L2 in user-facing surfaces. We guard the
    // whole source — internal-only code may use L1/L2 in identifiers, but this
    // builder only produces user-facing copy via the locked `copy.ts` strings.
    // Word-boundary match so identifiers like `L10n` don't false-positive.
    const matches = source.match(/\bL[12]\b/g) ?? [];
    expect(matches.length).toBe(0);
  });

  it("contains zero en-dash characters (U+2013) for good measure", () => {
    expect(source.includes("\u2013")).toBe(false);
  });
});
