import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("getSlackClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when SLACK_BOT_TOKEN is not set", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const { getSlackClient } = await import("./client");
    expect(() => getSlackClient()).toThrow("SLACK_BOT_TOKEN is not configured");
  });
});

describe("getUpdatesChannelId", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws when SLACK_UPDATES_CHANNEL_ID is not set", async () => {
    delete process.env.SLACK_UPDATES_CHANNEL_ID;
    const { getUpdatesChannelId } = await import("./client");
    expect(() => getUpdatesChannelId()).toThrow(
      "SLACK_UPDATES_CHANNEL_ID is not configured"
    );
  });

  it("returns the channel ID when set", async () => {
    process.env.SLACK_UPDATES_CHANNEL_ID = "C12345";
    const { getUpdatesChannelId } = await import("./client");
    expect(getUpdatesChannelId()).toBe("C12345");
  });
});
