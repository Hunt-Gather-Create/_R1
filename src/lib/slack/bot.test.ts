import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockPostMessage = vi.fn().mockResolvedValue({ ok: true });
const mockConversationsReplies = vi.fn().mockResolvedValue({ messages: [] });
vi.mock("./client", () => ({
  getSlackClient: () => ({
    chat: { postMessage: mockPostMessage },
    conversations: { replies: mockConversationsReplies },
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
  buildBotSystemPrompt: vi.fn().mockResolvedValue("mocked system prompt"),
}));

const mockRecordTokenUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/token-usage", () => ({
  recordTokenUsage: (...args: unknown[]) => mockRecordTokenUsage(...args),
}));

describe("handleDirectMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversationsReplies.mockResolvedValue({ messages: [] });
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
    expect(anthropic).toHaveBeenCalledWith("claude-haiku-4-5-20251001");
  });

  it("limits AI to MAX_STEPS tool calls", async () => {
    const { generateText, stepCountIs } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    expect(stepCountIs).toHaveBeenCalledWith(12);
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
    // messages[0] is the cached system message; user message is at [1]
    expect(call.messages[1]).toEqual({ role: "user", content: "CDS went to Daniel" });
  });

  it("sends images as content blocks when images are provided", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "I see the image",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "what is this?", "ts123", undefined, [
      { mimetype: "image/png", base64: "iVBORw0KGgo=" },
    ]);

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages[1].content).toEqual([
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
    await handleDirectMessage("U12345", "D67890", "", "ts123", undefined, [
      { mimetype: "image/jpeg", base64: "/9j/4AAQ=" },
    ]);

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages[1].content).toEqual([
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
    await handleDirectMessage("U12345", "D67890", "just text", "ts123", undefined, []);

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.messages[1].content).toBe("just text");
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
    // System prompt is now a cached message in the messages array
    expect(call.messages[0]).toEqual(
      expect.objectContaining({
        role: "system",
        content: "mocked system prompt",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      })
    );
  });
});

describe("thread history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversationsReplies.mockResolvedValue({ messages: [] });
  });

  it("builds multi-turn messages when threadTs is provided", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Got it",
      steps: [{ toolCalls: [] }],
    });

    mockConversationsReplies.mockResolvedValue({
      messages: [
        { ts: "1111.0000", text: "CDS went to Daniel", user: "U12345" },
        { ts: "1111.0001", text: "Got it, updated.", bot_id: "B99" },
      ],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "also update deadline", "1111.0002", "1111.0000");

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // messages[0] is system; thread history + current message follow
    expect(call.messages.slice(1)).toEqual([
      { role: "user", content: "CDS went to Daniel" },
      { role: "assistant", content: "Got it, updated." },
      { role: "user", content: "also update deadline" },
    ]);
  });

  it("uses single message when no threadTs", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // messages[0] is system; only user message follows
    expect(call.messages.slice(1)).toEqual([{ role: "user", content: "hello" }]);
    expect(mockConversationsReplies).not.toHaveBeenCalled();
  });

  it("caps thread history at 20 messages", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    // Create 25 messages (all before current message)
    const messages = Array.from({ length: 25 }, (_, i) => ({
      ts: `1111.${String(i).padStart(4, "0")}`,
      text: `message ${i}`,
      user: "U12345",
    }));

    mockConversationsReplies.mockResolvedValue({ messages });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "latest", "1111.9999", "1111.0000");

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // 1 system + 20 from history + 1 current = 22
    expect(call.messages).toHaveLength(22);
  });

  it("posts response with threadTs when present", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response in thread",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "1111.0002", "1111.0000");

    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: "D67890",
      text: "response in thread",
      thread_ts: "1111.0000",
    });
  });

  it("excludes empty messages from thread history", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    mockConversationsReplies.mockResolvedValue({
      messages: [
        { ts: "1111.0000", text: "hello", user: "U12345" },
        { ts: "1111.0001", text: "", bot_id: "B99" },
        { ts: "1111.0002", text: "world", user: "U12345" },
      ],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "latest", "1111.9999", "1111.0000");

    const call = (generateText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // 1 system + "hello", "world" from history + "latest" current = 4 (empty message excluded)
    expect(call.messages).toHaveLength(4);
  });
});

describe("proactive follow-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversationsReplies.mockResolvedValue({ messages: [] });
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
    expect(mockPostMessage.mock.calls[1][0].text).toContain("While I have you");
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

  it("excludes projects updated via update_project_field from proactive follow-up", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Updated deadline.",
      steps: [{
        toolCalls: [{
          toolName: "update_project_field",
          input: { clientSlug: "convergix", projectName: "CDS Messaging", field: "dueDate", newValue: "2026-05-01" },
        }],
      }],
    });

    const ops = await import("@/lib/runway/operations");
    (ops.getStaleItemsForAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([
      { clientName: "Convergix", projectName: "CDS Messaging", staleDays: 10 },
      { clientName: "Convergix", projectName: "Old Brochure", staleDays: 20 },
    ]);

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "push CDS deadline", "ts123");

    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    const followUpText = mockPostMessage.mock.calls[1][0].text;
    expect(followUpText).not.toContain("CDS Messaging");
    expect(followUpText).toContain("Old Brochure");
  });

  it("skips proactive follow-up when threadTs is present", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Got it.",
      steps: [{ toolCalls: [] }],
    });

    const ops = await import("@/lib/runway/operations");

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "CDS is done", "ts456", "ts123");

    // Should NOT call getStaleItemsForAccounts when in a thread
    expect(ops.getStaleItemsForAccounts).not.toHaveBeenCalled();
    expect(mockPostMessage).toHaveBeenCalledTimes(1); // Just the response
  });

  it("passes displayName to getStaleItemsForAccounts", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Got it.",
      steps: [{ toolCalls: [] }],
    });

    const ops = await import("@/lib/runway/operations");
    // Reset mocks to default — prior tests may have overridden these
    (ops.getTeamMemberBySlackId as ReturnType<typeof vi.fn>).mockResolvedValue("Kathy Horn");
    (ops.getTeamMemberRecordBySlackId as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: "Kathy Horn",
      firstName: "Kathy",
      title: "Creative Director / Copywriter",
      roleCategory: "leadership",
      accountsLed: ["convergix"],
    });
    (ops.getStaleItemsForAccounts as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    expect(ops.getStaleItemsForAccounts).toHaveBeenCalledWith(["convergix"], "Kathy Horn");
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

describe("sanitizeToolInput", () => {
  it("passes through safe structural fields", async () => {
    const { sanitizeToolInput } = await import("./bot");
    const result = sanitizeToolInput({
      clientSlug: "convergix",
      projectName: "CDS",
      field: "dueDate",
      newValue: "2026-05-01",
    });
    expect(result).toEqual({
      clientSlug: "convergix",
      projectName: "CDS",
      field: "dueDate",
      newValue: "2026-05-01",
    });
  });

  it("strips sensitive free-text fields", async () => {
    const { sanitizeToolInput } = await import("./bot");
    const result = sanitizeToolInput({
      clientSlug: "convergix",
      projectName: "CDS",
      notes: "Confidential client info here",
      summary: "Secret details",
      name: "should not appear",
    });
    expect(result).toEqual({
      clientSlug: "convergix",
      projectName: "CDS",
    });
    expect(result).not.toHaveProperty("notes");
    expect(result).not.toHaveProperty("summary");
    expect(result).not.toHaveProperty("name");
  });

  it("handles empty input", async () => {
    const { sanitizeToolInput } = await import("./bot");
    expect(sanitizeToolInput({})).toEqual({});
  });

  it("includes all safe fields when present", async () => {
    const { sanitizeToolInput } = await import("./bot");
    const result = sanitizeToolInput({
      clientSlug: "x", projectName: "y", field: "f", newValue: "v",
      newStatus: "s", weekOf: "w", weekItemTitle: "t", personName: "p",
      dayOfWeek: "monday", date: "2026-01-01", category: "deadline",
      since: "2026-01-01", limit: 10,
    });
    expect(Object.keys(result)).toHaveLength(13);
  });
});

describe("token usage tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversationsReplies.mockResolvedValue({ messages: [] });
  });

  it("calls recordTokenUsage with correct params after successful response", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
      usage: { inputTokens: 500, outputTokens: 150 },
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    expect(mockRecordTokenUsage).toHaveBeenCalledWith({
      workspaceId: "runway-bot",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 500,
      outputTokens: 150,
      source: "runway-bot",
    });
  });

  it("defaults to 0 tokens when usage is missing", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
    });

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    expect(mockRecordTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 0, outputTokens: 0 })
    );
  });

  it("does not fail the bot response when token tracking throws", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "response",
      steps: [{ toolCalls: [] }],
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    mockRecordTokenUsage.mockRejectedValueOnce(new Error("DB down"));

    const { handleDirectMessage } = await import("./bot");
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    // Bot response still posted despite token tracking failure
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "response" })
    );
  });
});

describe("toolCalls/toolResults guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConversationsReplies.mockResolvedValue({ messages: [] });
  });

  it("handles steps with undefined toolCalls and toolResults without crashing", async () => {
    const { generateText } = await import("ai");
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: "Just a text response",
      steps: [
        { /* text-only step — no toolCalls or toolResults */ },
        { toolCalls: [{ toolName: "get_clients", input: {} }], toolResults: [{ toolName: "get_clients", output: "[]" }] },
        { toolCalls: undefined, toolResults: undefined },
      ],
    });

    const { handleDirectMessage } = await import("./bot");
    // Should not throw
    await handleDirectMessage("U12345", "D67890", "hello", "ts123");

    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Just a text response" })
    );
  });
});
