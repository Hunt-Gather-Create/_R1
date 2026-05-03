import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BASELINE_PARENT_PICKER_HINT,
  BOT_SINGLE_INTERCEPT_REPLY,
  CASCADE_DEADLINE_EXPLAINER,
  CONCURRENT_PROPOSAL_SOFT_WARN,
  MODAL_CANCELLED,
  MODAL_CANCELLED_THREAD_REPLY,
  MODAL_HEADERS,
  PARENT_PROJECT_NOT_FOUND,
  TASK_BUTTON_DISABLED,
  formatBotMultiDetectReply,
  formatEditConfirmation,
  formatEditMultiMatchHint,
  formatEditNoMatch,
  formatMultiMatchHint,
  formatProjectConfirmation,
  formatRetainerConfirmation,
  formatTaskConfirmation,
  formatTeamMemberConfirmation,
  formatValidationError,
} from "./copy";

// ---------------------------------------------------------------------------
// Bot replies
// ---------------------------------------------------------------------------

describe("BOT_SINGLE_INTERCEPT_REPLY", () => {
  it("matches the locked v7 string verbatim", () => {
    expect(BOT_SINGLE_INTERCEPT_REPLY).toBe(
      "📋 Got it - Click the button below to review and add any additional details, then click submit to save.",
    );
  });

  it("uses hyphen-space-hyphen, not em-dash", () => {
    expect(BOT_SINGLE_INTERCEPT_REPLY).not.toMatch(/\u2014/);
    expect(BOT_SINGLE_INTERCEPT_REPLY).toContain(" - ");
  });
});

describe("formatBotMultiDetectReply", () => {
  it("interpolates the count and matches the locked string", () => {
    expect(formatBotMultiDetectReply(2)).toBe(
      "📋 Got it - I caught 2 items. Click each below to review and save.",
    );
    expect(formatBotMultiDetectReply(5)).toBe(
      "📋 Got it - I caught 5 items. Click each below to review and save.",
    );
  });

  it("never emits an em-dash regardless of input", () => {
    for (let n = 1; n <= 10; n++) {
      expect(formatBotMultiDetectReply(n)).not.toMatch(/\u2014/);
    }
  });
});

// ---------------------------------------------------------------------------
// Modal headers
// ---------------------------------------------------------------------------

describe("MODAL_HEADERS — create", () => {
  // The create headers were shortened on 2026-04-30 to fit Slack's <25 char
  // modal-title cap (operator manual test caught a "must be less than 25
  // characters" rejection on the previous "Review and save - new task" copy).
  it("newProject is locked verbatim", () => {
    expect(MODAL_HEADERS.newProject).toBe("New project");
  });

  it("newRetainer is locked verbatim", () => {
    expect(MODAL_HEADERS.newRetainer).toBe("New retainer");
  });

  it("newTask is locked verbatim", () => {
    expect(MODAL_HEADERS.newTask).toBe("New task");
  });

  it("newTeamMember is locked verbatim", () => {
    expect(MODAL_HEADERS.newTeamMember).toBe("New team member");
  });

  it("none of the create headers contain an em-dash", () => {
    expect(MODAL_HEADERS.newProject).not.toMatch(/\u2014/);
    expect(MODAL_HEADERS.newRetainer).not.toMatch(/\u2014/);
    expect(MODAL_HEADERS.newTask).not.toMatch(/\u2014/);
    expect(MODAL_HEADERS.newTeamMember).not.toMatch(/\u2014/);
  });

  it("every create header fits Slack's <25 char modal-title cap", () => {
    expect(MODAL_HEADERS.newProject.length).toBeLessThan(25);
    expect(MODAL_HEADERS.newRetainer.length).toBeLessThan(25);
    expect(MODAL_HEADERS.newTask.length).toBeLessThan(25);
    expect(MODAL_HEADERS.newTeamMember.length).toBeLessThan(25);
  });
});

describe("MODAL_HEADERS — edit", () => {
  it("editProject interpolates title with hyphen-space-hyphen", () => {
    expect(MODAL_HEADERS.editProject("AG1 Q2 Brand Refresh")).toBe(
      "Edit project - AG1 Q2 Brand Refresh",
    );
  });

  it("editRetainer interpolates title with hyphen-space-hyphen", () => {
    expect(MODAL_HEADERS.editRetainer("AG1 Pro 2026")).toBe("Edit retainer - AG1 Pro 2026");
  });

  it("editTask interpolates title with hyphen-space-hyphen", () => {
    expect(MODAL_HEADERS.editTask("Draft homepage hero")).toBe(
      "Edit task - Draft homepage hero",
    );
  });

  it("editTeamMember interpolates fullName with hyphen-space-hyphen", () => {
    expect(MODAL_HEADERS.editTeamMember("Jason Burks")).toBe(
      "Edit team member - Jason Burks",
    );
  });

  it("none of the edit formatters emit em-dashes for representative inputs", () => {
    const samples = [
      "Plain Title",
      "Title with - existing hyphen",
      "Title (with parens)",
      "Title 'with quotes'",
    ];
    for (const s of samples) {
      expect(MODAL_HEADERS.editProject(s)).not.toMatch(/\u2014/);
      expect(MODAL_HEADERS.editRetainer(s)).not.toMatch(/\u2014/);
      expect(MODAL_HEADERS.editTask(s)).not.toMatch(/\u2014/);
      expect(MODAL_HEADERS.editTeamMember(s)).not.toMatch(/\u2014/);
    }
  });
});

// ---------------------------------------------------------------------------
// Confirmation messages — create
// ---------------------------------------------------------------------------

describe("formatProjectConfirmation", () => {
  it("matches the locked v7 string with title and client", () => {
    expect(formatProjectConfirmation("Website Build", "AG1")).toBe(
      "✅ Saved. Website Build added to AG1.",
    );
  });

  it("never emits an em-dash", () => {
    expect(formatProjectConfirmation("Foo", "Bar")).not.toMatch(/\u2014/);
  });
});

describe("formatRetainerConfirmation", () => {
  it("matches the locked v7 string with title and client", () => {
    expect(formatRetainerConfirmation("AG1 Pro 2026", "AG1")).toBe(
      "✅ Saved. AG1 Pro 2026 retainer added to AG1.",
    );
  });

  it("includes the literal word 'retainer'", () => {
    expect(formatRetainerConfirmation("X", "Y")).toContain("retainer");
  });
});

describe("formatTaskConfirmation", () => {
  it("matches the locked v7 string with title and project", () => {
    expect(formatTaskConfirmation("Draft homepage hero", "Website Build")).toBe(
      "✅ Saved. Draft homepage hero added to Website Build.",
    );
  });
});

describe("formatTeamMemberConfirmation", () => {
  it("matches the locked v7 string with fullName", () => {
    expect(formatTeamMemberConfirmation("Jason Burks")).toBe(
      "✅ Saved. Jason Burks added to the team.",
    );
  });
});

// ---------------------------------------------------------------------------
// Confirmation messages — edit
// ---------------------------------------------------------------------------

describe("formatEditConfirmation", () => {
  it("matches the locked v7 string with title and field summary", () => {
    expect(
      formatEditConfirmation("Website Build", "status from in_progress to completed"),
    ).toBe("✅ Updated. Website Build: changed status from in_progress to completed.");
  });

  it("supports a multi-field summary string", () => {
    expect(formatEditConfirmation("AG1 Pro 2026", "owner and dueDate")).toBe(
      "✅ Updated. AG1 Pro 2026: changed owner and dueDate.",
    );
  });

  it("never emits an em-dash for representative inputs", () => {
    expect(formatEditConfirmation("Title", "field")).not.toMatch(/\u2014/);
  });
});

// ---------------------------------------------------------------------------
// Modal cancel / view_closed
// ---------------------------------------------------------------------------

describe("MODAL_CANCELLED", () => {
  it("matches the locked v7 string verbatim", () => {
    expect(MODAL_CANCELLED).toBe(
      "No worries - discarded that draft. DM me again when you're ready.",
    );
  });

  it("uses hyphen-space-hyphen, not em-dash", () => {
    expect(MODAL_CANCELLED).not.toMatch(/\u2014/);
    expect(MODAL_CANCELLED).toContain(" - ");
  });
});

describe("MODAL_CANCELLED_THREAD_REPLY (Wave 11)", () => {
  it("matches the locked Wave 11 string verbatim", () => {
    expect(MODAL_CANCELLED_THREAD_REPLY).toBe(
      "Got it - dismissed without saving. Run the slash command again or ping me to start over.",
    );
  });

  it("uses hyphen-space-hyphen, not em-dash", () => {
    expect(MODAL_CANCELLED_THREAD_REPLY).not.toMatch(/\u2014/);
    expect(MODAL_CANCELLED_THREAD_REPLY).toContain(" - ");
  });
});

describe("CONCURRENT_PROPOSAL_SOFT_WARN (Wave 11)", () => {
  it("interpolates user mention and title in the locked shape", () => {
    expect(CONCURRENT_PROPOSAL_SOFT_WARN("U_ABC", "Website Build")).toBe(
      'Heads up - <@U_ABC> opened a similar form ("Website Build") in this channel within the last minute. Confirm before saving to avoid duplicates.',
    );
  });

  it("omits the title clause when title is empty", () => {
    expect(CONCURRENT_PROPOSAL_SOFT_WARN("U_XYZ", "")).toBe(
      "Heads up - <@U_XYZ> opened a similar form in this channel within the last minute. Confirm before saving to avoid duplicates.",
    );
  });

  it("never emits an em-dash for representative inputs", () => {
    const samples = ["", "Plain Title", "Title with - hyphen", "Quote'd"];
    for (const s of samples) {
      expect(CONCURRENT_PROPOSAL_SOFT_WARN("U", s)).not.toMatch(/\u2014/);
    }
  });

  it("uses hyphen-space-hyphen lead-in", () => {
    expect(CONCURRENT_PROPOSAL_SOFT_WARN("U", "X")).toContain("Heads up - ");
  });
});

// ---------------------------------------------------------------------------
// Disabled-button click ephemeral
// ---------------------------------------------------------------------------

describe("TASK_BUTTON_DISABLED", () => {
  it("matches the locked v7 string verbatim", () => {
    expect(TASK_BUTTON_DISABLED).toBe(
      "Save the project first - I'll enable this once it's saved.",
    );
  });

  it("uses hyphen-space-hyphen, not em-dash", () => {
    expect(TASK_BUTTON_DISABLED).not.toMatch(/\u2014/);
  });
});

// ---------------------------------------------------------------------------
// Lazy-resolution failure
// ---------------------------------------------------------------------------

describe("PARENT_PROJECT_NOT_FOUND", () => {
  it("matches the locked v7 string verbatim", () => {
    expect(PARENT_PROJECT_NOT_FOUND).toBe(
      "Parent project not found. Save the project first, then submit this task.",
    );
  });
});

// ---------------------------------------------------------------------------
// Edit slash-command — no-match ephemeral
// ---------------------------------------------------------------------------

describe("formatEditNoMatch", () => {
  it("formats the task variant", () => {
    expect(formatEditNoMatch("task", "Draft homepage hero")).toBe(
      "Couldn't find a task matching 'Draft homepage hero'. Check the name or use /runway-new-task to create.",
    );
  });

  it("formats the project variant", () => {
    expect(formatEditNoMatch("project", "Website Build")).toBe(
      "Couldn't find a project matching 'Website Build'. Check the name or use /runway-new-project to create.",
    );
  });

  it("formats the team-member variant", () => {
    expect(formatEditNoMatch("team-member", "Jason Burks")).toBe(
      "Couldn't find a team-member matching 'Jason Burks'. Check the name or use /runway-new-team-member to create.",
    );
  });

  it("never emits an em-dash for representative inputs", () => {
    expect(formatEditNoMatch("task", "anything")).not.toMatch(/\u2014/);
    expect(formatEditNoMatch("project", "anything")).not.toMatch(/\u2014/);
    expect(formatEditNoMatch("team-member", "anything")).not.toMatch(/\u2014/);
  });
});

// ---------------------------------------------------------------------------
// Edit slash-command — multi-match disambiguation hint
// ---------------------------------------------------------------------------

describe("formatEditMultiMatchHint", () => {
  it("formats the task variant", () => {
    expect(formatEditMultiMatchHint(3, "task", "Hero")).toBe(
      "We found 3 tasks matching 'Hero' - confirm below.",
    );
  });

  it("formats the project variant", () => {
    expect(formatEditMultiMatchHint(2, "project", "Brand Refresh")).toBe(
      "We found 2 projects matching 'Brand Refresh' - confirm below.",
    );
  });

  it("formats the team-member variant (note plural pluralization)", () => {
    expect(formatEditMultiMatchHint(4, "team-member", "Jason")).toBe(
      "We found 4 team-members matching 'Jason' - confirm below.",
    );
  });

  it("uses hyphen-space-hyphen before 'confirm'", () => {
    expect(formatEditMultiMatchHint(2, "project", "X")).toContain(" - confirm below.");
    expect(formatEditMultiMatchHint(2, "project", "X")).not.toMatch(/\u2014/);
  });
});

// ---------------------------------------------------------------------------
// Parent-picker hints (v7 §A3)
// ---------------------------------------------------------------------------

describe("BASELINE_PARENT_PICKER_HINT", () => {
  // Critical assertion called out by the v7 §A3 spec.
  it("is exactly 'Double-check the parent before submitting.'", () => {
    expect(BASELINE_PARENT_PICKER_HINT).toBe(
      "Double-check the parent before submitting.",
    );
  });

  it("contains no em-dash", () => {
    expect(BASELINE_PARENT_PICKER_HINT).not.toMatch(/\u2014/);
  });
});

describe("formatMultiMatchHint (parent picker)", () => {
  // Critical assertion called out by the v7 §A3 spec.
  it("returns the locked string for the project variant", () => {
    expect(formatMultiMatchHint(3, "AG1", "project")).toBe(
      "We found 3 projects matching 'AG1' - confirm the parent below.",
    );
  });

  it("returns the locked string for the retainer variant", () => {
    expect(formatMultiMatchHint(2, "AG1", "retainer")).toBe(
      "We found 2 retainers matching 'AG1' - confirm the parent below.",
    );
  });

  it("uses hyphen-space-hyphen, NOT em-dash, before 'confirm the parent'", () => {
    const out = formatMultiMatchHint(3, "AG1", "project");
    expect(out).toContain(" - confirm the parent below.");
    expect(out).not.toMatch(/\u2014/);
  });

  it("never emits an em-dash for a sweep of representative inputs", () => {
    const names = ["AG1", "Plain", "Title with - hyphen", "With'apostrophe"];
    for (const n of names) {
      expect(formatMultiMatchHint(2, n, "project")).not.toMatch(/\u2014/);
      expect(formatMultiMatchHint(2, n, "retainer")).not.toMatch(/\u2014/);
    }
  });
});

// ---------------------------------------------------------------------------
// Cascade-deadline explainer
// ---------------------------------------------------------------------------

describe("CASCADE_DEADLINE_EXPLAINER", () => {
  it("matches the locked v7 string verbatim", () => {
    expect(CASCADE_DEADLINE_EXPLAINER).toBe(
      "⚠️ On future date changes, this updates the parent project's dueDate. endDate, status, and notes changes do NOT cascade.",
    );
  });

  it("contains no em-dash", () => {
    expect(CASCADE_DEADLINE_EXPLAINER).not.toMatch(/\u2014/);
  });
});

// ---------------------------------------------------------------------------
// Validator soft-warn wrapper
// ---------------------------------------------------------------------------

describe("formatValidationError", () => {
  it("renders the matrix-teaching string for a representative reject", () => {
    expect(
      formatValidationError("validateStatusCategoryCompatibility", "completed", "active"),
    ).toBe(
      "Status `completed` can't pair with category `active`. Pick `completed` for the category, or change the status.",
    );
  });

  it("does not emit an em-dash regardless of input", () => {
    expect(
      formatValidationError("validateStatusCategoryCompatibility", "in_progress", "deadline"),
    ).not.toMatch(/\u2014/);
  });

  it("wraps the status and category values in backticks for Slack code formatting", () => {
    const out = formatValidationError("rule", "todo", "active");
    expect(out).toContain("`todo`");
    expect(out).toContain("`active`");
  });
});

// ---------------------------------------------------------------------------
// Wave 10 — Async-write error / validation surfaces
// ---------------------------------------------------------------------------

describe("MODAL_VALIDATION_FAILED_INTRO + formatWriteError", () => {
  it("MODAL_VALIDATION_FAILED_INTRO uses hyphen-space-hyphen, not em-dash", async () => {
    const { MODAL_VALIDATION_FAILED_INTRO } = await import("./copy");
    expect(MODAL_VALIDATION_FAILED_INTRO).not.toMatch(/\u2014/);
    expect(MODAL_VALIDATION_FAILED_INTRO).toContain(" - ");
  });

  it("formatWriteError interpolates detail and uses hyphen-space-hyphen", async () => {
    const { formatWriteError } = await import("./copy");
    const out = formatWriteError("DB write failed");
    expect(out).toContain("DB write failed");
    expect(out).not.toMatch(/\u2014/);
    expect(out).toContain(" - ");
  });
});

// ---------------------------------------------------------------------------
// Source-level grep guard — no em-dashes, no L1/L2 tokens anywhere in copy.ts
// ---------------------------------------------------------------------------

describe("source-level grep guard on copy.ts", () => {
  // Resolve the source file path relative to this test file. __dirname is set
  // automatically by Vitest at runtime when the test file is loaded.
  const sourcePath = path.join(__dirname, "copy.ts");
  const source = fs.readFileSync(sourcePath, "utf8");

  it("contains zero em-dash characters (U+2014)", () => {
    expect(source.includes("\u2014")).toBe(false);
  });

  it("contains zero L1 or L2 tokens, including in comments (this file is the contract)", () => {
    // Word-boundary match so we never trip on identifiers like 'L10n' etc.
    expect(source.match(/\bL[12]\b/)).toBeNull();
  });

  it("contains zero en-dash characters (U+2013) for good measure", () => {
    // Belt-and-suspenders: en-dashes also slip past visual review and read as
    // 'AI-sounding' in the same way em-dashes do.
    expect(source.includes("\u2013")).toBe(false);
  });
});
