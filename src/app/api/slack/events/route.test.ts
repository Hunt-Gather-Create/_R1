import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSlackSignature, nowTimestamp } from "@/lib/slack/test-helpers";
import { makeRequest } from "./route-test-helpers";

// Mock inngest before importing route
vi.mock("@/lib/inngest/client", () => ({
  inngest: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("POST /api/slack/events — validation", () => {
  const SIGNING_SECRET = "test_secret";

  beforeEach(() => {
    vi.resetModules();
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("returns 500 when SLACK_SIGNING_SECRET is not configured", async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const { POST } = await import("./route");

    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Server misconfigured");
  });

  it("returns 403 for invalid signature", async () => {
    const { POST } = await import("./route");

    const req = makeRequest("{}", { signature: "v0=invalid" });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Invalid signature");
  });

  it("returns 403 when signature header is missing", async () => {
    const { POST } = await import("./route");

    const req = makeRequest("{}", { signature: null });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid JSON body", async () => {
    const { POST } = await import("./route");

    const body = "not json";
    const ts = nowTimestamp();
    const sig = makeSlackSignature(SIGNING_SECRET, ts, body);
    const req = makeRequest(body, { signature: sig, timestamp: ts });

    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON");
  });

  it("handles url_verification challenge", async () => {
    const { POST } = await import("./route");

    const body = JSON.stringify({
      type: "url_verification",
      challenge: "test_challenge_token",
    });
    const req = makeRequest(body);

    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.challenge).toBe("test_challenge_token");
  });
});

describe("POST /api/slack/events — image attachments", () => {
  const SIGNING_SECRET = "test_secret";

  beforeEach(() => {
    vi.resetModules();
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  it("includes imageFiles in Inngest event when message has image attachments", async () => {
    const { POST } = await import("./route");
    const { inngest } = await import("@/lib/inngest/client");

    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel_type: "im",
        user: "U12345",
        channel: "D67890",
        text: "check this out",
        ts: "1234567890.123456",
        files: [
          { mimetype: "image/png", url_private: "https://files.slack.com/img.png", name: "screenshot.png" },
        ],
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
        messageText: "check this out",
        messageTs: "1234567890.123456",
        imageFiles: [
          { url: "https://files.slack.com/img.png", mimetype: "image/png", name: "screenshot.png" },
        ],
      },
    });
  });

  it("filters out non-image files", async () => {
    const { POST } = await import("./route");
    const { inngest } = await import("@/lib/inngest/client");

    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel_type: "im",
        user: "U12345",
        channel: "D67890",
        text: "here's a file",
        ts: "1234567890.123456",
        files: [
          { mimetype: "application/pdf", url_private: "https://files.slack.com/doc.pdf", name: "doc.pdf" },
          { mimetype: "image/jpeg", url_private: "https://files.slack.com/photo.jpg", name: "photo.jpg" },
        ],
      },
    });
    const req = makeRequest(body);
    await POST(req as never);

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          imageFiles: [
            { url: "https://files.slack.com/photo.jpg", mimetype: "image/jpeg", name: "photo.jpg" },
          ],
        }),
      })
    );
  });

  it("dispatches image-only messages (no text)", async () => {
    const { POST } = await import("./route");
    const { inngest } = await import("@/lib/inngest/client");

    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel_type: "im",
        user: "U12345",
        channel: "D67890",
        text: "",
        ts: "1234567890.123456",
        files: [
          { mimetype: "image/webp", url_private: "https://files.slack.com/img.webp", name: "img.webp" },
        ],
      },
    });
    const req = makeRequest(body);
    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageText: "",
          imageFiles: [
            { url: "https://files.slack.com/img.webp", mimetype: "image/webp", name: "img.webp" },
          ],
        }),
      })
    );
  });

  it("does not include imageFiles when there are no image attachments", async () => {
    const { POST } = await import("./route");
    const { inngest } = await import("@/lib/inngest/client");

    const body = JSON.stringify({
      type: "event_callback",
      event: {
        type: "message",
        channel_type: "im",
        user: "U12345",
        channel: "D67890",
        text: "just text",
        ts: "1234567890.123456",
      },
    });
    const req = makeRequest(body);
    await POST(req as never);

    expect(inngest.send).toHaveBeenCalledWith({
      name: "runway/slack.message",
      data: {
        slackUserId: "U12345",
        channelId: "D67890",
        messageText: "just text",
        messageTs: "1234567890.123456",
        imageFiles: undefined,
      },
    });
  });
});
