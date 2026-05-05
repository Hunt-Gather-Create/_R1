/**
 * Tests for the shared multi-match candidate picker block builder
 * (`buildMultiMatchCandidatePicker`). Wave 7 / Fix 7.1.
 *
 * Locks the per-kind label/placeholder contract, the 100-option cap, the
 * 75-char label truncation rule, and the last-8 id-suffix description.
 *
 * Civ voice: ASCII hyphens only, no em-dashes.
 */
import { describe, expect, it } from "vitest";
import {
  buildMultiMatchCandidatePicker,
  SLACK_OPTION_LABEL_MAX,
  SLACK_STATIC_SELECT_OPTIONS_MAX,
} from "./picker-block";

type PickerBlock = {
  type: string;
  block_id: string;
  dispatch_action: boolean;
  label: { type: string; text: string; emoji?: boolean };
  element: {
    type: string;
    action_id: string;
    placeholder: { type: string; text: string; emoji?: boolean };
    options: Array<{
      text: { type: string; text: string; emoji?: boolean };
      value: string;
      description?: { type: string; text: string; emoji?: boolean };
    }>;
  };
};

const sampleCandidates = [
  { id: "wi_concept_writeup_full_id", label: "Concept Writeup" },
  { id: "wi_kickoff_full_id_xyzabcd", label: "Kickoff Call" },
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("picker-block constants", () => {
  it("SLACK_OPTION_LABEL_MAX is 75 (Slack hard cap)", () => {
    expect(SLACK_OPTION_LABEL_MAX).toBe(75);
  });

  it("SLACK_STATIC_SELECT_OPTIONS_MAX is 100 (Slack hard cap)", () => {
    expect(SLACK_STATIC_SELECT_OPTIONS_MAX).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Per-kind label + placeholder
// ---------------------------------------------------------------------------

describe("buildMultiMatchCandidatePicker - per-kind labels", () => {
  it('"task" returns the documented input-block shape with the task label and placeholder', () => {
    const block = buildMultiMatchCandidatePicker("task", sampleCandidates) as PickerBlock;
    expect(block.type).toBe("input");
    expect(block.block_id).toBe("multi_match_candidate_block");
    expect(block.dispatch_action).toBe(true);
    expect(block.label.type).toBe("plain_text");
    expect(block.label.text).toBe("Tasks matching your search");
    expect(block.element.type).toBe("static_select");
    expect(block.element.action_id).toBe("multi_match_candidate_select");
    expect(block.element.placeholder.text).toBe("Pick the task to edit");
  });

  it('"project" returns the documented input-block shape with the project label and placeholder', () => {
    const block = buildMultiMatchCandidatePicker("project", sampleCandidates) as PickerBlock;
    expect(block.type).toBe("input");
    expect(block.block_id).toBe("multi_match_candidate_block");
    expect(block.dispatch_action).toBe(true);
    expect(block.label.text).toBe("Projects matching your search");
    expect(block.element.type).toBe("static_select");
    expect(block.element.action_id).toBe("multi_match_candidate_select");
    expect(block.element.placeholder.text).toBe("Pick the project to edit");
  });

  it('"team-member" returns the documented input-block shape with the team-member label and placeholder', () => {
    const block = buildMultiMatchCandidatePicker(
      "team-member",
      sampleCandidates,
    ) as PickerBlock;
    expect(block.type).toBe("input");
    expect(block.block_id).toBe("multi_match_candidate_block");
    expect(block.dispatch_action).toBe(true);
    expect(block.label.text).toBe("Team members matching your search");
    expect(block.element.type).toBe("static_select");
    expect(block.element.action_id).toBe("multi_match_candidate_select");
    expect(block.element.placeholder.text).toBe("Pick the team member to edit");
  });

  it("never emits an em-dash in label or placeholder for any kind", () => {
    for (const kind of ["task", "project", "team-member"] as const) {
      const block = buildMultiMatchCandidatePicker(kind, sampleCandidates) as PickerBlock;
      expect(block.label.text).not.toMatch(/\u2014/);
      expect(block.element.placeholder.text).not.toMatch(/\u2014/);
    }
  });
});

// ---------------------------------------------------------------------------
// 100-option cap
// ---------------------------------------------------------------------------

describe("buildMultiMatchCandidatePicker - 100-option cap", () => {
  it("renders only 100 options when given 150 candidates", () => {
    const candidates = Array.from({ length: 150 }, (_, i) => ({
      id: `proj_${String(i).padStart(20, "0")}`,
      label: `Project ${i}`,
    }));
    const block = buildMultiMatchCandidatePicker("project", candidates) as PickerBlock;
    expect(block.element.options).toHaveLength(100);
    // Slice from the head: first option corresponds to candidate 0.
    expect(block.element.options[0].value).toBe(candidates[0].id);
    expect(block.element.options[99].value).toBe(candidates[99].id);
  });

  it("renders all options when count is below the cap", () => {
    const block = buildMultiMatchCandidatePicker("task", sampleCandidates) as PickerBlock;
    expect(block.element.options).toHaveLength(2);
  });

  it("renders an empty options array when no candidates supplied", () => {
    const block = buildMultiMatchCandidatePicker("task", []) as PickerBlock;
    expect(block.element.options).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 75-char label truncation
// ---------------------------------------------------------------------------

describe("buildMultiMatchCandidatePicker - 75-char label truncation", () => {
  it("leaves a 75-char label unchanged", () => {
    const exactly75 = "a".repeat(75);
    const block = buildMultiMatchCandidatePicker("task", [
      { id: "wi_short_id", label: exactly75 },
    ]) as PickerBlock;
    expect(block.element.options[0].text.text).toBe(exactly75);
    expect(block.element.options[0].text.text.length).toBe(75);
  });

  it("truncates a 76-char label to 72 chars + '...'", () => {
    const seventySix = "a".repeat(76);
    const block = buildMultiMatchCandidatePicker("task", [
      { id: "wi_short_id", label: seventySix },
    ]) as PickerBlock;
    const out = block.element.options[0].text.text;
    expect(out.length).toBe(75);
    expect(out.endsWith("...")).toBe(true);
    expect(out).toBe(`${"a".repeat(72)}...`);
  });

  it("truncates a much longer label to 72 chars + '...'", () => {
    const huge = "a".repeat(500);
    const block = buildMultiMatchCandidatePicker("project", [
      { id: "proj_short", label: huge },
    ]) as PickerBlock;
    const out = block.element.options[0].text.text;
    expect(out.length).toBe(75);
    expect(out.endsWith("...")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// id-suffix description
// ---------------------------------------------------------------------------

describe("buildMultiMatchCandidatePicker - id-suffix description", () => {
  it("renders '...{last8}' for a 25-char id", () => {
    const id = "proj_brand_refresh_xyz123"; // 25 chars
    expect(id.length).toBe(25);
    const block = buildMultiMatchCandidatePicker("project", [
      { id, label: "Brand Refresh" },
    ]) as PickerBlock;
    expect(block.element.options[0].description?.text).toBe(`...${id.slice(-8)}`);
    expect(block.element.options[0].description?.text).toBe("...h_xyz123");
  });

  it("renders '...{id}' for a short 5-char id (id length <= 8)", () => {
    const id = "abc12"; // 5 chars
    const block = buildMultiMatchCandidatePicker("task", [
      { id, label: "Short" },
    ]) as PickerBlock;
    expect(block.element.options[0].description?.text).toBe(`...${id}`);
    expect(block.element.options[0].description?.text).toBe("...abc12");
  });

  it("renders '...{id}' for an 8-char id (boundary: > 8 is the slice gate)", () => {
    const id = "abcd1234"; // exactly 8 chars
    const block = buildMultiMatchCandidatePicker("team-member", [
      { id, label: "Boundary" },
    ]) as PickerBlock;
    expect(block.element.options[0].description?.text).toBe(`...${id}`);
  });

  it("renders '...{last8}' for a 9-char id (boundary: > 8 triggers slice)", () => {
    const id = "abcde1234"; // 9 chars
    const block = buildMultiMatchCandidatePicker("team-member", [
      { id, label: "Boundary" },
    ]) as PickerBlock;
    expect(block.element.options[0].description?.text).toBe(`...${id.slice(-8)}`);
    expect(block.element.options[0].description?.text).toBe("...bcde1234");
    expect(block.element.options[0].description?.text.length).toBe(11);
  });
});
