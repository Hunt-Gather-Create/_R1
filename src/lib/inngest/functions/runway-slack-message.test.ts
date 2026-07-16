import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const mockHandleDirectMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/slack/bot", () => ({
  handleDirectMessage: mockHandleDirectMessage,
}));

// Mock the inngest client to capture the function definition
const mockStepRun = vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn());
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

// Mock fetch for image downloads
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: any;

describe("processRunwaySlackMessage", () => {
  beforeAll(async () => {
    await import("./runway-slack-message");
    handler = mockCreateFunction.mock.calls[0][2];
  });

  beforeEach(() => {
    mockHandleDirectMessage.mockClear();
    mockStepRun.mockClear();
    mockFetch.mockReset();
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  });

  it("is registered with correct ID and concurrency", () => {
    expect(mockCreateFunction).toHaveBeenCalledOnce();
    const [config, event] = mockCreateFunction.mock.calls[0];
    expect(config.id).toBe("runway-slack-message");
    expect(config.retries).toBe(2);
    expect(config.concurrency).toEqual({ limit: 3 });
    expect(event).toEqual({ event: "runway/slack.message" });
  });

  it("dedupes retries at the queue layer via messageTs idempotency key (#35)", () => {
    // Function-level `idempotency` is an expression evaluated against
    // `event.data` at dispatch time. Slack's messageTs is unique per user
    // message, so a second dispatch with the same key becomes a no-op
    // instead of re-running the AI turn + re-posting `chat.postMessage`.
    const [config] = mockCreateFunction.mock.calls[0];
    expect(config.idempotency).toBe("event.data.messageTs");
  });

  it("calls handleDirectMessage with event data inside step.run", async () => {
    // handler captured in beforeAll
    const eventData = {
      data: {
        slackUserId: "U12345",
        channelId: "D67890",
        messageText: "CDS is done",
        messageTs: "1234567890.123456",
      },
    };

    const result = await handler({ event: eventData, step: { run: mockStepRun } });

    expect(mockStepRun).toHaveBeenCalledWith("download-images", expect.any(Function));
    expect(mockStepRun).toHaveBeenCalledWith("process-message", expect.any(Function));
    expect(mockHandleDirectMessage).toHaveBeenCalledWith(
      "U12345",
      "D67890",
      "CDS is done",
      "1234567890.123456",
      undefined, // no threadTs
      [] // no images
    );
    expect(result).toEqual({ processed: true });
  });

  it("passes threadTs to handleDirectMessage when present", async () => {
    const eventData = {
      data: {
        slackUserId: "U12345",
        channelId: "D67890",
        messageText: "thread reply",
        messageTs: "1234567890.999999",
        threadTs: "1234567890.111111",
      },
    };

    await handler({ event: eventData, step: { run: mockStepRun } });

    expect(mockHandleDirectMessage).toHaveBeenCalledWith(
      "U12345",
      "D67890",
      "thread reply",
      "1234567890.999999",
      "1234567890.111111",
      []
    );
  });

  it("downloads images and passes them to handleDirectMessage", async () => {
    // Mock fetch to return image data
    const fakeImageBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeImageBuffer),
    });

    // handler captured in beforeAll
    const eventData = {
      data: {
        slackUserId: "U12345",
        channelId: "D67890",
        messageText: "check this",
        messageTs: "1234567890.123456",
        imageFiles: [
          { url: "https://files.slack.com/img.png", mimetype: "image/png", name: "img.png" },
        ],
      },
    };

    await handler({ event: eventData, step: { run: mockStepRun } });

    // Verify fetch was called with auth header
    expect(mockFetch).toHaveBeenCalledWith("https://files.slack.com/img.png", {
      headers: { Authorization: "Bearer xoxb-test-token" },
    });

    // Verify images were passed to handleDirectMessage
    const expectedBase64 = Buffer.from(fakeImageBuffer).toString("base64");
    expect(mockHandleDirectMessage).toHaveBeenCalledWith(
      "U12345",
      "D67890",
      "check this",
      "1234567890.123456",
      undefined, // no threadTs
      [{ mimetype: "image/png", base64: expectedBase64 }]
    );
  });

  it("skips failed image downloads gracefully", async () => {
    // First image succeeds, second fails with HTTP error
    const fakeImageBuffer = new Uint8Array([0x89, 0x50]).buffer;
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeImageBuffer),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

    const eventData = {
      data: {
        slackUserId: "U12345",
        channelId: "D67890",
        messageText: "two images",
        messageTs: "1234567890.123456",
        imageFiles: [
          { url: "https://files.slack.com/good.png", mimetype: "image/png" },
          { url: "https://files.slack.com/bad.png", mimetype: "image/png" },
        ],
      },
    };

    await handler({ event: eventData, step: { run: mockStepRun } });

    // Only the successful image should be passed through
    const expectedBase64 = Buffer.from(fakeImageBuffer).toString("base64");
    expect(mockHandleDirectMessage).toHaveBeenCalledWith(
      "U12345", "D67890", "two images", "1234567890.123456",
      undefined, [{ mimetype: "image/png", base64: expectedBase64 }]
    );
  });

  it("handles network errors during image download", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const eventData = {
      data: {
        slackUserId: "U12345",
        channelId: "D67890",
        messageText: "broken image",
        messageTs: "1234567890.123456",
        imageFiles: [
          { url: "https://files.slack.com/err.png", mimetype: "image/png" },
        ],
      },
    };

    await handler({ event: eventData, step: { run: mockStepRun } });

    // Should still call handleDirectMessage with empty images array
    expect(mockHandleDirectMessage).toHaveBeenCalledWith(
      "U12345", "D67890", "broken image", "1234567890.123456", undefined, []
    );
  });

  it("skips image download when no bot token is configured", async () => {
    delete process.env.SLACK_BOT_TOKEN;

    // handler captured in beforeAll
    const eventData = {
      data: {
        slackUserId: "U12345",
        channelId: "D67890",
        messageText: "hello",
        messageTs: "1234567890.123456",
        imageFiles: [
          { url: "https://files.slack.com/img.png", mimetype: "image/png" },
        ],
      },
    };

    await handler({ event: eventData, step: { run: mockStepRun } });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockHandleDirectMessage).toHaveBeenCalledWith(
      "U12345", "D67890", "hello", "1234567890.123456", undefined, []
    );
  });
});
