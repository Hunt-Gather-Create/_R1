import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockPostMessage = vi.fn().mockResolvedValue({ ok: true });
vi.mock("./client", () => ({
  getSlackClient: () => ({
    chat: { postMessage: mockPostMessage },
  }),
}));

vi.mock("./updates-channel", () => ({
  postUpdate: vi.fn().mockResolvedValue("1234567890.123456"),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn((model: string) => ({ modelId: model })),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  tool: vi.fn((config) => config),
  stepCountIs: vi.fn((n) => n),
}));

vi.mock("@/lib/runway/operations", () => ({
  getClientsWithCounts: vi.fn().mockResolvedValue([]),
  getProjectsForClient: vi.fn().mockResolvedValue([]),
  getPipelineData: vi.fn().mockResolvedValue([]),
  getWeekItemsData: vi.fn().mockResolvedValue([]),
  getClientBySlug: vi.fn().mockResolvedValue(null),
  updateProjectStatus: vi
    .fn()
    .mockResolvedValue({ ok: true, message: "Updated" }),
  addUpdate: vi.fn().mockResolvedValue({ ok: true, message: "Logged" }),
  getTeamMemberBySlackId: vi.fn().mockResolvedValue("Kathy Horn"),
}));

describe("handleDirectMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends AI response as threaded reply", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Got it, marked as complete.",
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "CDS is done", "ts123");

    expect(generateText).toHaveBeenCalledOnce();
    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: "D67890",
      text: "Got it, marked as complete.",
      thread_ts: "ts123",
    });
  });

  it("looks up team member by Slack user ID", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Hi Kathy",
    });

    const ops = await import("@/lib/runway/operations");

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    expect(ops.getTeamMemberBySlackId).toHaveBeenCalledWith("U12345");
  });

  it("posts error message to DM when AI generation fails", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("API error")
    );

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: "D67890",
      text: "Something went wrong processing your message. Try again or check with the team.",
      thread_ts: "ts123",
    });
  });

  it("falls back to 'Unknown team member' when Slack ID not found", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
    });

    const ops = await import("@/lib/runway/operations");
    (ops.getTeamMemberBySlackId as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U_UNKNOWN", "D67890", "hello", "ts123");

    // Check that generateText was called with system prompt containing "Unknown team member"
    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.system).toContain("Unknown team member");
  });

  it("uses Haiku model", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    const { anthropic } = await import("@ai-sdk/anthropic");
    expect(anthropic).toHaveBeenCalledWith("claude-haiku-4-5-20251001");
  });

  it("limits AI to MAX_STEPS tool calls", async () => {
    const { generateText, stepCountIs } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    expect(stepCountIs).toHaveBeenCalledWith(5);
  });
});
