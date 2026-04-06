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
