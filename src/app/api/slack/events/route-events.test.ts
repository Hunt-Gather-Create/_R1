import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeRequest } from "./route-test-helpers";

// Mock inngest before importing route
vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("POST /api/slack/events — event handling", () => {
  const SIGNING_SECRET = "test_secret";

  beforeEach(() => {
    vi.resetModules();
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("ignores bot messages to prevent loops", async () => {
    const { inngest } = await import("@/lib/inngest/client");
    const { POST } = await import("./route");

    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel_type: "im",
        bot_id: "B12345",
        text: "bot message",
        user: "U12345",
        channel: "D12345",
        ts: "1234567890.123456",
      },
    });
    const req = makeRequest(body);

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("ignores message edits and subtypes", async () => {
    const { inngest } = await import("@/lib/inngest/client");
    const { POST } = await import("./route");

    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel_type: "im",
        subtype: "message_changed",
        text: "edited message",
        user: "U12345",
        channel: "D12345",
        ts: "1234567890.123456",
      },
    });
    const req = makeRequest(body);

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("dispatches valid DM messages to Inngest", async () => {
    const { inngest } = await import("@/lib/inngest/client");
    const { POST } = await import("./route");

    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel_type: "im",
        text: "Convergix CDS went to Daniel",
        user: "U12345",
        channel: "D67890",
        ts: "1234567890.123456",
      },
    });
    const req = makeRequest(body);

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(inngest.send).toHaveBeenCalledWith({
      name: "runway/slack.message",
      data: {
        slackUserId: "U12345",
        channelId: "D67890",
        messageText: "Convergix CDS went to Daniel",
        messageTs: "1234567890.123456",
        imageFiles: undefined,
      },
    });
  });

  it("returns 200 for event_callback with no event", async () => {
    const { POST } = await import("./route");

    const body = JSON.stringify({
      type: "event_callback",
    });
    const req = makeRequest(body);

    const res = await POST(req as never);
    expect(res.status).toBe(200);
  });

  it("returns 200 for unrecognized event types", async () => {
    const { POST } = await import("./route");

    const body = JSON.stringify({
      type: "app_rate_limited",
    });
    const req = makeRequest(body);

    const res = await POST(req as never);
    expect(res.status).toBe(200);
  });
});
