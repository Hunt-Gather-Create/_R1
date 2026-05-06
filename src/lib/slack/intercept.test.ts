/**
 * Wave 7 / Builder 7 — bot LLM intercept tests.
 *
 * Replaces the disposable Spike C termination test
 * (`spike-c-termination.test.ts`). Now targets the production helper
 * `interceptCreateForModal()` and the `stopOnModalOpened` predicate that ships
 * to bot.ts.
 *
 * Coverage:
 *   - single intercept proposal insertion + flag set
 *   - multi-detect parallel calls (same step) all allowed; share intent_group_id
 *   - subsequent-step rejection when modal already open
 *   - stopOnModalOpened predicate behavior on tool result shape
 *   - extractInterceptedProposals over result.steps
 *   - composeButtonBearingReply: single, multi, mixed read+create
 *   - retainer-cue propagation (isRetainer === true -> kind === "retainer")
 *   - feature-flag short-circuit when disabled
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --------------------------------------------------------------------------
// Hoisted mocks — proposal.insertProposal + feature-flags
// --------------------------------------------------------------------------

const { mockInsertProposal, mockFlagState } = vi.hoisted(() => {
  const mockInsertProposal = vi.fn();
  const mockFlagState = { enabled: true };
  return { mockInsertProposal, mockFlagState };
});

vi.mock("./modals/proposal", () => ({
  insertProposal: mockInsertProposal,
}));

vi.mock("@/lib/feature-flags", () => ({
  isModalInterceptEnabled: () => mockFlagState.enabled,
}));

// Re-import after mocks register.
import {
  interceptCreateForModal,
  stopOnModalOpened,
  extractInterceptedProposals,
  composeButtonBearingReply,
  type ConvoState,
  type InterceptResult,
} from "./modals/intercept";

function freshConvo(): ConvoState {
  return { modalAlreadyOpened: false, openStep: null, currentStep: 0 };
}

const baseContext = {
  slackUserId: "U_USER",
  channelId: "D_CHAN",
  threadTs: null,
  intentGroupId: "ig_test_1",
};

beforeEach(() => {
  mockInsertProposal.mockReset();
  mockFlagState.enabled = true;
  // Default: every insert returns a unique-ish id derived from call count.
  mockInsertProposal.mockImplementation(async () => ({
    proposalId: `prop_${mockInsertProposal.mock.calls.length}`,
  }));
});

describe("interceptCreateForModal — single create", () => {
  it("inserts proposal, sets flag + openStep, returns modalOpened payload", async () => {
    const convoState = freshConvo();
    convoState.currentStep = 0;

    const result = await interceptCreateForModal({
      toolName: "create_week_item",
      args: { title: "Concept Writeup", date: "2026-05-04" },
      context: baseContext,
      convoState,
    });

    expect("modalOpened" in result && result.modalOpened).toBe(true);
    if ("modalOpened" in result) {
      expect(result.proposalId).toBe("prop_1");
      expect(result.kind).toBe("task");
      expect(result.title).toBe("Concept Writeup");
    }

    expect(convoState.modalAlreadyOpened).toBe(true);
    expect(convoState.openStep).toBe(0);

    expect(mockInsertProposal).toHaveBeenCalledOnce();
    const insertArgs = mockInsertProposal.mock.calls[0][0];
    expect(insertArgs.kind).toBe("create");
    expect(insertArgs.toolName).toBe("create_week_item");
    expect(insertArgs.userSlackId).toBe("U_USER");
    expect(insertArgs.intentGroupId).toBe("ig_test_1");
  });

  it("maps create_project (isRetainer=false) -> kind 'project'", async () => {
    const convoState = freshConvo();
    const result = await interceptCreateForModal({
      toolName: "create_project",
      args: { name: "AG1 Pro Q1", clientSlug: "ag1" },
      context: baseContext,
      convoState,
    });
    expect("modalOpened" in result && result.kind).toBe("project");
    expect("modalOpened" in result && result.title).toBe("AG1 Pro Q1");
  });

  it("maps create_project with isRetainer=true -> kind 'retainer'", async () => {
    const convoState = freshConvo();
    const result = await interceptCreateForModal({
      toolName: "create_project",
      args: { name: "AG1 Pro 2026", clientSlug: "ag1", isRetainer: true },
      context: baseContext,
      convoState,
    });
    expect("modalOpened" in result && result.kind).toBe("retainer");
  });

  it("maps create_team_member -> kind 'team_member' and reads fullName for title", async () => {
    const convoState = freshConvo();
    const result = await interceptCreateForModal({
      toolName: "create_team_member",
      args: { name: "Lane", fullName: "Lane Davis" },
      context: baseContext,
      convoState,
    });
    expect("modalOpened" in result && result.kind).toBe("team_member");
    expect("modalOpened" in result && result.title).toBe("Lane Davis");
  });

  it("falls back to args.name when fullName is missing on create_team_member", async () => {
    const convoState = freshConvo();
    const result = await interceptCreateForModal({
      toolName: "create_team_member",
      args: { name: "Lane" },
      context: baseContext,
      convoState,
    });
    expect("modalOpened" in result && result.title).toBe("Lane");
  });

  it("propagates pendingProjectName from args to insertProposal + result", async () => {
    const convoState = freshConvo();
    const result = await interceptCreateForModal({
      toolName: "create_week_item",
      args: { title: "Concept Writeup", pendingProjectName: "AG1 Pro 2026" },
      context: baseContext,
      convoState,
    });
    expect("modalOpened" in result && result.parentProjectName).toBe("AG1 Pro 2026");
    const insertArgs = mockInsertProposal.mock.calls[0][0];
    expect(insertArgs.pendingProjectName).toBe("AG1 Pro 2026");
  });
});

describe("interceptCreateForModal — step-aware flag", () => {
  it("allows N parallel calls in the SAME step (multi-detect)", async () => {
    const convoState = freshConvo();
    convoState.currentStep = 0;

    const r1 = await interceptCreateForModal({
      toolName: "create_project",
      args: { name: "AG1 Pro 2026", isRetainer: true },
      context: baseContext,
      convoState,
    });
    const r2 = await interceptCreateForModal({
      toolName: "create_week_item",
      args: { title: "Concept Writeup", date: "2026-05-04", pendingProjectName: "AG1 Pro 2026" },
      context: baseContext,
      convoState,
    });
    const r3 = await interceptCreateForModal({
      toolName: "create_week_item",
      args: { title: "Concept Writeup", date: "2026-05-11", pendingProjectName: "AG1 Pro 2026" },
      context: baseContext,
      convoState,
    });

    expect("modalOpened" in r1 && r1.modalOpened).toBe(true);
    expect("modalOpened" in r2 && r2.modalOpened).toBe(true);
    expect("modalOpened" in r3 && r3.modalOpened).toBe(true);
    expect(mockInsertProposal).toHaveBeenCalledTimes(3);
    // All three share the same intent_group_id (came from context).
    for (const call of mockInsertProposal.mock.calls) {
      expect(call[0].intentGroupId).toBe("ig_test_1");
    }
  });

  it("rejects when called in a SUBSEQUENT step after modal opened in step 0", async () => {
    const convoState = freshConvo();
    convoState.currentStep = 0;

    const r1 = await interceptCreateForModal({
      toolName: "create_week_item",
      args: { title: "First task" },
      context: baseContext,
      convoState,
    });
    expect("modalOpened" in r1 && r1.modalOpened).toBe(true);

    // LLM kept looping somehow. We're now in step 1.
    convoState.currentStep = 1;
    const r2 = await interceptCreateForModal({
      toolName: "create_week_item",
      args: { title: "Second task" },
      context: baseContext,
      convoState,
    });
    expect("error" in r2).toBe(true);
    expect("error" in r2 && r2.error).toMatch(/already open/i);
    // 2nd call did NOT insert another proposal.
    expect(mockInsertProposal).toHaveBeenCalledOnce();
  });
});

describe("interceptCreateForModal — feature flag", () => {
  it("returns error when isModalInterceptEnabled() is false", async () => {
    mockFlagState.enabled = false;
    const convoState = freshConvo();
    const result = await interceptCreateForModal({
      toolName: "create_week_item",
      args: { title: "Disabled" },
      context: baseContext,
      convoState,
    });
    expect("error" in result).toBe(true);
    expect(mockInsertProposal).not.toHaveBeenCalled();
    // Flag stays clean.
    expect(convoState.modalAlreadyOpened).toBe(false);
  });
});

describe("stopOnModalOpened predicate", () => {
  it("returns true when latest step has any modalOpened toolResult", () => {
    const steps = [
      {
        toolResults: [
          { toolName: "create_week_item", output: { modalOpened: true, proposalId: "prop_1" } },
        ],
      },
    ];
    expect(stopOnModalOpened({ steps } as never)).toBe(true);
  });

  it("returns false when latest step has no modalOpened toolResults", () => {
    const steps = [
      { toolResults: [{ toolName: "get_clients", output: [{ name: "Convergix" }] }] },
    ];
    expect(stopOnModalOpened({ steps } as never)).toBe(false);
  });

  it("returns false when steps is empty", () => {
    expect(stopOnModalOpened({ steps: [] } as never)).toBe(false);
  });

  it("returns false when latest step has no toolResults at all", () => {
    expect(stopOnModalOpened({ steps: [{}] } as never)).toBe(false);
  });

  it("returns true when ANY of multiple parallel toolResults has modalOpened", () => {
    const steps = [
      {
        toolResults: [
          { toolName: "get_clients", output: [{ name: "Convergix" }] },
          { toolName: "create_week_item", output: { modalOpened: true, proposalId: "prop_2" } },
        ],
      },
    ];
    expect(stopOnModalOpened({ steps } as never)).toBe(true);
  });
});

describe("extractInterceptedProposals", () => {
  it("returns [] when no toolResults", () => {
    expect(extractInterceptedProposals({ steps: [{}] })).toEqual([]);
  });

  it("returns [] when toolResults exist but none have modalOpened", () => {
    const result = {
      steps: [
        { toolResults: [{ toolName: "get_clients", output: [] }] },
      ],
    };
    expect(extractInterceptedProposals(result)).toEqual([]);
  });

  it("extracts a single intercepted proposal from step 0", () => {
    const result = {
      steps: [
        {
          toolResults: [
            {
              toolName: "create_week_item",
              output: {
                modalOpened: true,
                proposalId: "prop_1",
                kind: "task" as const,
                title: "Concept Writeup",
              },
            },
          ],
        },
      ],
    };
    const out = extractInterceptedProposals(result);
    expect(out).toHaveLength(1);
    expect(out[0].proposalId).toBe("prop_1");
    expect(out[0].kind).toBe("task");
  });

  it("extracts multiple intercepted proposals (multi-detect) and ignores non-intercept results", () => {
    const result = {
      steps: [
        {
          toolResults: [
            { toolName: "get_clients", output: [{ name: "AG1" }] },
            {
              toolName: "create_project",
              output: {
                modalOpened: true,
                proposalId: "prop_proj",
                kind: "retainer" as const,
                title: "AG1 Pro 2026",
              },
            },
            {
              toolName: "create_week_item",
              output: {
                modalOpened: true,
                proposalId: "prop_task_1",
                kind: "task" as const,
                title: "Concept Writeup",
                parentProjectName: "AG1 Pro 2026",
              },
            },
          ],
        },
      ],
    };
    const out = extractInterceptedProposals(result);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.proposalId)).toEqual(["prop_proj", "prop_task_1"]);
  });

  it("ignores tool error outputs (output without modalOpened)", () => {
    const result = {
      steps: [
        {
          toolResults: [
            {
              toolName: "create_week_item",
              output: { error: "A form is already open." },
            },
          ],
        },
      ],
    };
    expect(extractInterceptedProposals(result)).toEqual([]);
  });
});

describe("composeButtonBearingReply", () => {
  const single: InterceptResult = {
    modalOpened: true,
    proposalId: "prop_1",
    kind: "task",
    title: "Concept Writeup",
  };

  const proj: InterceptResult = {
    modalOpened: true,
    proposalId: "prop_proj",
    kind: "retainer",
    title: "AG1 Pro 2026",
  };

  const task1: InterceptResult = {
    modalOpened: true,
    proposalId: "prop_task_1",
    kind: "task",
    title: "Concept Writeup (May 4)",
    parentProjectName: "AG1 Pro 2026",
  };

  const task2: InterceptResult = {
    modalOpened: true,
    proposalId: "prop_task_2",
    kind: "task",
    title: "Concept Writeup (May 11)",
    parentProjectName: "AG1 Pro 2026",
  };

  it("single intercept: text uses BOT_SINGLE_INTERCEPT_REPLY + 1 actions block with 1 button", () => {
    const out = composeButtonBearingReply([single], "");
    expect(out.text).toMatch(/Click the button below/);
    const actionsBlocks = out.blocks.filter((b) => b.type === "actions");
    expect(actionsBlocks).toHaveLength(1);
    const buttons = actionsBlocks[0].elements ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].action_id).toBe("open_create_modal");
    expect(buttons[0].value).toBe("prop_1");
  });

  it("multi intercept: text counts items + 1 button per intercepted proposal (project first)", () => {
    const out = composeButtonBearingReply([proj, task1, task2], "");
    expect(out.text).toMatch(/I caught 3 items/);
    const buttons =
      (out.blocks.find((b) => b.type === "actions")?.elements as Array<{
        action_id?: string;
        value?: string;
      }>) ?? [];
    expect(buttons).toHaveLength(3);
    // Project first (kind === "project" or "retainer" sorts ahead of "task").
    expect(buttons[0].value).toBe("prop_proj");
    expect(buttons[1].value).toBe("prop_task_1");
    expect(buttons[2].value).toBe("prop_task_2");
  });

  it("multi intercept: task buttons are disabled (style=danger) when parentProjectName is set and project is also staged", () => {
    const out = composeButtonBearingReply([proj, task1, task2], "");
    const buttons = (out.blocks.find((b) => b.type === "actions")?.elements as Array<{
      action_id?: string;
      style?: string;
    }>) ?? [];
    // Project button is primary / enabled.
    expect(buttons[0].style).toBe("primary");
    // Tasks point to a not-yet-saved project — surfaced as danger style and the
    // "task_button_disabled" action_id, the Wave 8 handler will ephemeral-respond.
    expect(buttons[1].action_id).toBe("task_button_disabled");
    expect(buttons[2].action_id).toBe("task_button_disabled");
  });

  it("multi intercept WITHOUT a project: tasks are enabled (open_create_modal)", () => {
    const standaloneTask: InterceptResult = {
      modalOpened: true,
      proposalId: "prop_solo",
      kind: "task",
      title: "Standalone task",
    };
    const out = composeButtonBearingReply([single, standaloneTask], "");
    const buttons = (out.blocks.find((b) => b.type === "actions")?.elements as Array<{
      action_id?: string;
    }>) ?? [];
    // Both tasks; no project staged in this batch -> both buttons open the create modal.
    expect(buttons.every((b) => b.action_id === "open_create_modal")).toBe(true);
  });

  it("mixed read+create reply: prepends LLM text as a section block above buttons", () => {
    const out = composeButtonBearingReply(
      [single],
      "Convergix has 3 retainers active.",
    );
    // Order: text-from-LLM section, then bot-intro section (BOT_SINGLE_INTERCEPT_REPLY), then actions.
    const sections = out.blocks.filter((b) => b.type === "section");
    expect(sections.length).toBeGreaterThanOrEqual(2);
    const firstText = (sections[0].text as { text?: string })?.text ?? "";
    expect(firstText).toContain("Convergix has 3 retainers active");
    // Top-level `text` field carries the same combined string for accessibility / fallbacks.
    expect(out.text).toContain("Convergix has 3 retainers active");
    expect(out.text).toContain("Click the button below");
  });

  it("single intercept with empty replyText: no extra section block, just intro + button", () => {
    const out = composeButtonBearingReply([single], "");
    const sections = out.blocks.filter((b) => b.type === "section");
    expect(sections).toHaveLength(1);
  });
});
