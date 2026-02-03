import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  persistedToUIMessages,
  groupChatsByDate,
  formatFileSize,
  createAttachmentPart,
} from "./chat-utils";
import type { WorkspaceChatMessage, WorkspaceChatAttachment } from "@/lib/types";

// Helper to create a mock message
function createMessage(
  overrides: Partial<WorkspaceChatMessage & { attachments: WorkspaceChatAttachment[] }> = {}
): WorkspaceChatMessage & { attachments: WorkspaceChatAttachment[] } {
  return {
    id: "msg-1",
    chatId: "chat-1",
    role: "assistant",
    content: "Hello",
    createdAt: new Date(),
    attachments: [],
    ...overrides,
  };
}

// Helper to create a mock attachment
function createAttachment(overrides: Partial<WorkspaceChatAttachment> = {}): WorkspaceChatAttachment {
  return {
    id: "att-1",
    chatId: "chat-1",
    messageId: "msg-1",
    filename: "test.md",
    content: "# Test",
    mimeType: "text/markdown",
    size: 100,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("persistedToUIMessages", () => {
  it("converts a simple text message", () => {
    const messages = [createMessage({ content: "Hello world" })];
    const result = persistedToUIMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("msg-1");
    expect(result[0].role).toBe("assistant");
    expect(result[0].parts).toHaveLength(1);
    expect(result[0].parts[0]).toEqual({ type: "text", text: "Hello world" });
  });

  it("converts a user message", () => {
    const messages = [createMessage({ role: "user", content: "Hi there" })];
    const result = persistedToUIMessages(messages);

    expect(result[0].role).toBe("user");
    expect(result[0].parts[0]).toEqual({ type: "text", text: "Hi there" });
  });

  it("adds attachments at the end when no placeholders exist", () => {
    const attachment = createAttachment({ id: "att-1", filename: "doc.md", size: 100 });
    const messages = [
      createMessage({
        content: "Here is your document",
        attachments: [attachment],
      }),
    ];
    const result = persistedToUIMessages(messages);

    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts[0]).toEqual({ type: "text", text: "Here is your document" });
    expect(result[0].parts[1]).toMatchObject({
      type: "text",
      text: "📎 doc.md",
      __attachment: {
        id: "att-1",
        filename: "doc.md",
        size: 100,
      },
    });
  });

  it("places attachments at placeholder positions", () => {
    const attachment = createAttachment({ id: "abc-123", filename: "report.md", size: 100 });
    const messages = [
      createMessage({
        content: "Here is the report:\n\n[attachment:abc-123]\n\nLet me know if you need changes.",
        attachments: [attachment],
      }),
    ];
    const result = persistedToUIMessages(messages);

    expect(result[0].parts).toHaveLength(3);
    expect(result[0].parts[0]).toEqual({ type: "text", text: "Here is the report:" });
    expect(result[0].parts[1]).toMatchObject({
      type: "text",
      __attachment: {
        id: "abc-123",
      },
    });
    expect(result[0].parts[2]).toEqual({
      type: "text",
      text: "Let me know if you need changes.",
    });
  });

  it("handles multiple attachments with placeholders in order", () => {
    const att1 = createAttachment({ id: "aaa-111", filename: "first.md" });
    const att2 = createAttachment({ id: "bbb-222", filename: "second.md" });
    const messages = [
      createMessage({
        content:
          "First document:\n\n[attachment:aaa-111]\n\nSecond document:\n\n[attachment:bbb-222]\n\nDone!",
        attachments: [att1, att2],
      }),
    ];
    const result = persistedToUIMessages(messages);

    expect(result[0].parts).toHaveLength(5);
    expect(result[0].parts[0]).toEqual({ type: "text", text: "First document:" });
    expect(result[0].parts[1]).toMatchObject({
      type: "text",
      __attachment: {
        id: "aaa-111",
        filename: "first.md",
      },
    });
    expect(result[0].parts[2]).toEqual({ type: "text", text: "Second document:" });
    expect(result[0].parts[3]).toMatchObject({
      type: "text",
      __attachment: {
        id: "bbb-222",
        filename: "second.md",
      },
    });
    expect(result[0].parts[4]).toEqual({ type: "text", text: "Done!" });
  });

  it("handles attachments not in placeholders (fallback)", () => {
    const att1 = createAttachment({ id: "aaa-111", filename: "in-placeholder.md" });
    const att2 = createAttachment({ id: "bbb-222", filename: "orphan.md" });
    const messages = [
      createMessage({
        content: "Document:\n\n[attachment:aaa-111]",
        attachments: [att1, att2],
      }),
    ];
    const result = persistedToUIMessages(messages);

    expect(result[0].parts).toHaveLength(3);
    expect(result[0].parts[0]).toEqual({ type: "text", text: "Document:" });
    expect(result[0].parts[1]).toMatchObject({ type: "text", __attachment: { id: "aaa-111" } });
    // Orphan attachment added at the end
    expect(result[0].parts[2]).toMatchObject({ type: "text", __attachment: { id: "bbb-222" } });
  });

  it("handles empty content with attachments", () => {
    const attachment = createAttachment();
    const messages = [createMessage({ content: "", attachments: [attachment] })];
    const result = persistedToUIMessages(messages);

    // Empty text is not added, only attachment
    expect(result[0].parts).toHaveLength(1);
    expect(result[0].parts[0]).toMatchObject({ type: "text", __attachment: { id: "att-1" } });
  });

  it("ensures at least one part exists for empty messages", () => {
    const messages = [createMessage({ content: "", attachments: [] })];
    const result = persistedToUIMessages(messages);

    expect(result[0].parts).toHaveLength(1);
    expect(result[0].parts[0]).toEqual({ type: "text", text: "" });
  });

  it("ignores placeholders in user messages", () => {
    const attachment = createAttachment({ id: "abc-123" });
    const messages = [
      createMessage({
        role: "user",
        content: "Here is [attachment:abc-123] my message",
        attachments: [attachment],
      }),
    ];
    const result = persistedToUIMessages(messages);

    // User messages don't parse placeholders
    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts[0]).toEqual({
      type: "text",
      text: "Here is [attachment:abc-123] my message",
    });
    expect(result[0].parts[1]).toMatchObject({ type: "text", __attachment: { id: "abc-123" } });
  });

  it("handles multiple messages correctly", () => {
    const messages = [
      createMessage({ id: "msg-1", role: "user", content: "Question" }),
      createMessage({ id: "msg-2", role: "assistant", content: "Answer" }),
    ];
    const result = persistedToUIMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("msg-1");
    expect(result[1].id).toBe("msg-2");
  });

  // New JSON format tests
  it("parses JSON parts array format with text and tool calls", () => {
    const parts = [
      { type: "text", text: "Let me fetch that URL" },
      { type: "tool-fetchUrl", toolCallId: "tool-1", state: "output-available", output: { success: true } },
      { type: "text", text: "Here's what I found" },
    ];
    const messages = [
      createMessage({
        content: JSON.stringify(parts),
        attachments: [],
      }),
    ];
    const result = persistedToUIMessages(messages);

    expect(result[0].parts).toHaveLength(3);
    expect(result[0].parts[0]).toEqual({ type: "text", text: "Let me fetch that URL" });
    expect(result[0].parts[1]).toMatchObject({
      type: "tool-fetchUrl",
      toolCallId: "tool-1",
      state: "output-available",
    });
    expect(result[0].parts[2]).toEqual({ type: "text", text: "Here's what I found" });
  });

  it("converts tool-createFile parts to attachment parts in JSON format", () => {
    const attachment = createAttachment({ id: "att-123", filename: "doc.md", size: 500 });
    const parts = [
      { type: "text", text: "Here's the file" },
      {
        type: "tool-createFile",
        toolCallId: "tool-1",
        state: "output-available",
        output: { success: true, attachmentId: "att-123" },
      },
    ];
    const messages = [
      createMessage({
        content: JSON.stringify(parts),
        attachments: [attachment],
      }),
    ];
    const result = persistedToUIMessages(messages);

    expect(result[0].parts).toHaveLength(2);
    expect(result[0].parts[0]).toEqual({ type: "text", text: "Here's the file" });
    // tool-createFile should be converted to attachment part
    expect(result[0].parts[1]).toMatchObject({
      type: "text",
      __attachment: { id: "att-123", filename: "doc.md", size: 500 },
    });
  });

  it("preserves tool calls in JSON format after reload", () => {
    const parts = [
      { type: "text", text: "Loading skill" },
      { type: "tool-loadSkill", toolCallId: "tool-1", state: "output-available", output: { loaded: true } },
      { type: "text", text: "Skill loaded successfully" },
    ];
    const messages = [
      createMessage({
        content: JSON.stringify(parts),
        attachments: [],
      }),
    ];
    const result = persistedToUIMessages(messages);

    // Tool calls should be preserved
    const toolPart = result[0].parts.find((p) => p.type === "tool-loadSkill");
    expect(toolPart).toBeDefined();
    expect(toolPart).toMatchObject({
      type: "tool-loadSkill",
      state: "output-available",
    });
  });
});

describe("groupChatsByDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set current time to 2024-01-15 12:00:00
    vi.setSystemTime(new Date(2024, 0, 15, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups chats from today", () => {
    const chats = [
      { id: "1", updatedAt: new Date(2024, 0, 15, 10, 0, 0) },
      { id: "2", updatedAt: new Date(2024, 0, 15, 8, 0, 0) },
    ];
    const result = groupChatsByDate(chats);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Today");
    expect(result[0].chats).toHaveLength(2);
  });

  it("groups chats from yesterday", () => {
    const chats = [{ id: "1", updatedAt: new Date(2024, 0, 14, 20, 0, 0) }];
    const result = groupChatsByDate(chats);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Yesterday");
  });

  it("groups chats from last 7 days", () => {
    const chats = [
      { id: "1", updatedAt: new Date(2024, 0, 10, 12, 0, 0) },
      { id: "2", updatedAt: new Date(2024, 0, 12, 12, 0, 0) },
    ];
    const result = groupChatsByDate(chats);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Last 7 days");
    expect(result[0].chats).toHaveLength(2);
  });

  it("groups older chats", () => {
    const chats = [{ id: "1", updatedAt: new Date(2024, 0, 1, 12, 0, 0) }];
    const result = groupChatsByDate(chats);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Older");
  });

  it("groups chats into multiple categories", () => {
    const chats = [
      { id: "1", updatedAt: new Date(2024, 0, 15, 10, 0, 0) }, // Today
      { id: "2", updatedAt: new Date(2024, 0, 14, 10, 0, 0) }, // Yesterday
      { id: "3", updatedAt: new Date(2024, 0, 10, 10, 0, 0) }, // Last 7 days
      { id: "4", updatedAt: new Date(2024, 0, 1, 10, 0, 0) }, // Older
    ];
    const result = groupChatsByDate(chats);

    expect(result).toHaveLength(4);
    expect(result[0].label).toBe("Today");
    expect(result[1].label).toBe("Yesterday");
    expect(result[2].label).toBe("Last 7 days");
    expect(result[3].label).toBe("Older");
  });

  it("filters out empty groups", () => {
    const chats = [{ id: "1", updatedAt: new Date(2024, 0, 15, 10, 0, 0) }];
    const result = groupChatsByDate(chats);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Today");
  });

  it("uses createdAt when updatedAt is null", () => {
    const chats = [{ id: "1", updatedAt: null, createdAt: new Date(2024, 0, 15, 10, 0, 0) }];
    const result = groupChatsByDate(chats);

    expect(result[0].label).toBe("Today");
  });

  it("handles empty array", () => {
    const result = groupChatsByDate([]);
    expect(result).toHaveLength(0);
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(10240)).toBe("10.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatFileSize(100 * 1024 * 1024)).toBe("100.0 MB");
  });
});

describe("createAttachmentPart", () => {
  it("creates a text part with attachment metadata from an attachment", () => {
    const attachment = createAttachment({
      id: "test-id",
      filename: "document.md",
      size: 1234,
    });
    const result = createAttachmentPart(attachment);

    expect(result).toMatchObject({
      type: "text",
      text: "📎 document.md",
      __attachment: {
        id: "test-id",
        filename: "document.md",
        size: 1234,
      },
    });
  });
});
