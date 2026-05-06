import { describe, it, expect } from "vitest";
import { inngest } from "./client";
import type { Events } from "./client";

describe("inngest client", () => {
  it("exports an inngest client instance", () => {
    expect(inngest).toBeDefined();
    expect(inngest.id).toBe("auto-kanban");
  });

  it("has typed event schemas", () => {
    // Type-level check: Events type should include runway event
    const _check: Events["runway/slack.message"] = {
      data: {
        slackUserId: "U123",
        channelId: "C456",
        messageText: "hello",
        messageTs: "1234567890.123456",
      },
    };
    expect(_check.data.slackUserId).toBe("U123");
  });

  it("has brand guidelines research event type", () => {
    const _check: Events["brand/guidelines.research"] = {
      data: {
        brandId: "b1",
        brandName: "Test",
        workspaceId: "w1",
      },
    };
    expect(_check.data.brandId).toBe("b1");
  });

  it("has audience generation event type", () => {
    const _check: Events["audience/members.generate"] = {
      data: {
        audienceId: "a1",
        workspaceId: "w1",
        brandId: "b1",
        brandName: "Test",
        generationPrompt: "Generate",
      },
    };
    expect(_check.data.audienceId).toBe("a1");
  });

  // Slack Modal Wave 10 (2026-04-30) — payload shape locked per pre-plan v7.
  it("has slack-modal/submit event type with all locked fields", () => {
    const _check: Events["slack-modal/submit"] = {
      data: {
        proposalId: "prop_abc",
        modalCallbackId: "runway_new_task",
        stateValues: { block_id_1: { action_id_1: { type: "plain_text_input", value: "x" } } },
        userId: "U_TEST",
        teamId: "T_TEST",
        channelId: "C_TEST",
        threadTs: null,
        triggerId: "trig_xyz",
        submittedAt: "2026-04-30T12:00:00.000Z",
      },
    };
    expect(_check.data.proposalId).toBe("prop_abc");
    expect(_check.data.modalCallbackId).toBe("runway_new_task");
    expect(_check.data.threadTs).toBeNull();
  });

  it("slack-modal/submit modalCallbackId accepts all six callback ids (3 create + 3 edit)", () => {
    const ids: Array<Events["slack-modal/submit"]["data"]["modalCallbackId"]> = [
      "runway_new_task",
      "runway_new_project",
      "runway_new_team_member",
      "runway_edit_task",
      "runway_edit_project",
      "runway_edit_team_member",
    ];
    expect(ids).toHaveLength(6);
  });

  it("slack-modal/submit threadTs accepts string for threaded messages", () => {
    const _check: Events["slack-modal/submit"] = {
      data: {
        proposalId: "prop_abc",
        modalCallbackId: "runway_edit_project",
        stateValues: {},
        userId: "U_TEST",
        teamId: "T_TEST",
        channelId: "C_TEST",
        threadTs: "1700000000.000099",
        triggerId: "trig_xyz",
        submittedAt: "2026-04-30T12:00:00.000Z",
      },
    };
    expect(_check.data.threadTs).toBe("1700000000.000099");
  });
});
