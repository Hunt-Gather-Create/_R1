import { describe, it, expect, vi } from "vitest";

const mockHandleDirectMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/slack/bot", () => ({
  handleDirectMessage: mockHandleDirectMessage,
}));

// Mock the inngest client to capture the function definition
const mockStepRun = vi.fn(async (_name: string, fn: () => Promise<void>) => fn());
const mockCreateFunction = vi.fn((config, event, handler) => ({
  config,
  event,
  handler,
}));

vi.mock("../client", () => ({
  inngest: {
    createFunction: mockCreateFunction,
  },
}));

describe("processRunwaySlackMessage", () => {
  it("is registered with correct ID and concurrency", async () => {
    await import("./runway-slack-message");

    expect(mockCreateFunction).toHaveBeenCalledOnce();
    const [config, event] = mockCreateFunction.mock.calls[0];
    expect(config.id).toBe("runway-slack-message");
    expect(config.retries).toBe(2);
    expect(config.concurrency).toEqual({ limit: 3 });
    expect(event).toEqual({ event: "runway/slack.message" });
  });

  it("calls handleDirectMessage with event data inside step.run", async () => {
    await import("./runway-slack-message");

    const handler = mockCreateFunction.mock.calls[0][2];
    const eventData = {
      data: {
        slackUserId: "U12345",
        channelId: "D67890",
        messageText: "CDS is done",
        messageTs: "1234567890.123456",
      },
    };

    const result = await handler({ event: eventData, step: { run: mockStepRun } });

    expect(mockStepRun).toHaveBeenCalledWith("process-message", expect.any(Function));
    expect(mockHandleDirectMessage).toHaveBeenCalledWith(
      "U12345",
      "D67890",
      "CDS is done",
      "1234567890.123456"
    );
    expect(result).toEqual({ processed: true });
  });
});
