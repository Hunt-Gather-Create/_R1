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
  getTeamMemberRecordBySlackId: vi.fn().mockResolvedValue({
    name: "Kathy Horn",
    firstName: "Kathy",
    title: "Creative Director / Copywriter",
    roleCategory: "leadership",
    accountsLed: ["convergix"],
  }),
  getStaleItemsForAccounts: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/runway/bot-context", () => ({
  buildBotSystemPrompt: vi.fn().mockReturnValue("mocked system prompt"),
}));

describe("handleDirectMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends AI response as threaded reply", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Got it, marked as complete.",
      steps: [{ toolCalls: [] }],
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
      steps: [{ toolCalls: [] }],
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
      steps: [{ toolCalls: [] }],
    });

    const ops = await import("@/lib/runway/operations");
    (ops.getTeamMemberBySlackId as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );
    (ops.getTeamMemberRecordBySlackId as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );

    const botContext = await import("@/lib/runway/bot-context");

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U_UNKNOWN", "D67890", "hello", "ts123");

    // Check that buildBotSystemPrompt was called with null team member
    expect(botContext.buildBotSystemPrompt).toHaveBeenCalledWith(null, expect.any(Date));
  });

  it("uses Haiku model", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    const { anthropic } = await import("@ai-sdk/anthropic");
    expect(anthropic).toHaveBeenCalledWith("claude-sonnet-4-6");
  });

  it("limits AI to MAX_STEPS tool calls", async () => {
    const { generateText, stepCountIs } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    expect(stepCountIs).toHaveBeenCalledWith(5);
  });

  it("passes user message as content to AI", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "CDS went to Daniel", "ts123");

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages).toEqual([
      { role: "user", content: "CDS went to Daniel" },
    ]);
  });

  it("sends images as content blocks when images are provided", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "I see the image",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "what is this?", "ts123", [
      { mimetype: "image/png", base64: "iVBORw0KGgo=" },
    ]);

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages[0].content).toEqual([
      { type: "text", text: "what is this?" },
      { type: "image", image: "iVBORw0KGgo=", mediaType: "image/png" },
    ]);
  });

  it("sends image-only message as content blocks (no text)", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "That's a screenshot",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "", "ts123", [
      { mimetype: "image/jpeg", base64: "/9j/4AAQ=" },
    ]);

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages[0].content).toEqual([
      { type: "image", image: "/9j/4AAQ=", mediaType: "image/jpeg" },
    ]);
  });

  it("sends plain string content when no images", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "just text", "ts123", []);

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages[0].content).toBe("just text");
  });

  it("passes tools to generateText", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.tools).toBeDefined();
    expect(Object.keys(call.tools)).toContain("get_clients");
    expect(Object.keys(call.tools)).toContain("update_project_status");
  });

  it("sets maxRetries to 1", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.maxRetries).toBe(1);
  });
});

describe("buildBotSystemPrompt integration", () => {
  it("calls buildBotSystemPrompt with team member record and date", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const ops = await import("@/lib/runway/operations");
    // Ensure mock returns a record (may have been overridden by prior tests)
    (ops.getTeamMemberRecordBySlackId as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: "Kathy Horn",
      firstName: "Kathy",
      title: "Creative Director / Copywriter",
      roleCategory: "leadership",
      accountsLed: ["convergix"],
    });

    const botContext = await import("@/lib/runway/bot-context");

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    expect(botContext.buildBotSystemPrompt).toHaveBeenCalledWith(
      {
        name: "Kathy Horn",
        firstName: "Kathy",
        title: "Creative Director / Copywriter",
        roleCategory: "leadership",
        accountsLed: ["convergix"],
      },
      expect.any(Date)
    );
  });

  it("uses the prompt returned by buildBotSystemPrompt", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.system).toBe("mocked system prompt");
  });
});

describe("proactive follow-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends proactive follow-up when user leads accounts with stale items", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Got it, updated.",
      steps: [{ toolCalls: [] }],
    });

    const ops = await import("@/lib/runway/operations");
    (ops.getStaleItemsForAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { clientName: "Convergix", projectName: "Old Project", staleDays: 14 },
    ]);

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "CDS is done", "ts123");

    // First call: AI response, second call: proactive follow-up
    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    expect(mockPostMessage.mock.calls[1][0].text).toContain("Got a minute");
    expect(mockPostMessage.mock.calls[1][0].text).toContain("Old Project");
    expect(mockPostMessage.mock.calls[1][0].thread_ts).toBe("ts123");
  });

  it("excludes just-updated projects from proactive follow-up", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Updated CDS.",
      steps: [{
        toolCalls: [{
          toolName: "update_project_status",
          input: { clientSlug: "convergix", projectName: "CDS Messaging", newStatus: "completed" },
        }],
      }],
    });

    const ops = await import("@/lib/runway/operations");
    (ops.getStaleItemsForAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { clientName: "Convergix", projectName: "CDS Messaging", staleDays: 10 },
      { clientName: "Convergix", projectName: "Old Brochure", staleDays: 20 },
    ]);

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "CDS is done", "ts123");

    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    const followUpText = mockPostMessage.mock.calls[1][0].text;
    expect(followUpText).not.toContain("CDS Messaging");
    expect(followUpText).toContain("Old Brochure");
  });

  it("does NOT send follow-up when no stale items exist", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Done.",
      steps: [{ toolCalls: [] }],
    });

    const ops = await import("@/lib/runway/operations");
    (ops.getStaleItemsForAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    // Only the AI response, no follow-up
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
  });

  it("does NOT send follow-up when user has no accountsLed", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const ops = await import("@/lib/runway/operations");
    (ops.getTeamMemberRecordBySlackId as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: "Jason Burks",
      firstName: "Jason",
      title: "Dev",
      roleCategory: "dev",
      accountsLed: [],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U99999", "D67890", "hello", "ts123");

    expect(ops.getStaleItemsForAccounts).not.toHaveBeenCalled();
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
  });

  it("handles proactive follow-up error gracefully", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Done.",
      steps: [{ toolCalls: [] }],
    });

    const ops = await import("@/lib/runway/operations");
    (ops.getStaleItemsForAccounts as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB error")
    );

    const { handleDirectMessage } = await import("./bot");
    // Should not throw
    await handleDirectMessage("U12345", "D67890", "CDS is done", "ts123");

    // AI response still posted
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    expect(mockPostMessage.mock.calls[0][0].text).toBe("Done.");
  });
});
