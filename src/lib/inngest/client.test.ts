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
});
