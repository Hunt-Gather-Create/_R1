import { describe, it, expect } from "vitest";
import {
  parseMessageParts,
  serializeMessageParts,
  createUIMessage,
  persistedToUIMessagesBase,
} from "./message-persistence";

describe("parseMessageParts", () => {
  it("parses JSON parts array", () => {
    const parts = [
      { type: "text", text: "Hello" },
      { type: "tool-test", toolCallId: "1", state: "output-available", output: {} },
    ];
    const content = JSON.stringify(parts);
    const result = parseMessageParts(content);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "text", text: "Hello" });
    expect(result[1]).toMatchObject({ type: "tool-test", toolCallId: "1" });
  });

  it("falls back to text part for plain text content", () => {
    const result = parseMessageParts("Hello world");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "Hello world" });
  });

  it("falls back to text part for invalid JSON", () => {
    const result = parseMessageParts("[invalid json");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "[invalid json" });
  });

  it("falls back to text part for empty JSON array", () => {
    const result = parseMessageParts("[]");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "[]" });
  });

  it("handles JSON object (not array) as plain text", () => {
    const result = parseMessageParts('{"type": "text"}');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: '{"type": "text"}' });
  });
});

describe("serializeMessageParts", () => {
  it("serializes parts to JSON string", () => {
    const parts = [
      { type: "text" as const, text: "Hello" },
      { type: "tool-test", output: { success: true } },
    ];
    const result = serializeMessageParts(parts);

    expect(result).toBe(JSON.stringify(parts));
    expect(JSON.parse(result)).toEqual(parts);
  });
});

describe("createUIMessage", () => {
  it("creates UIMessage from persisted message with JSON parts", () => {
    const msg = {
      id: "msg-1",
      role: "assistant",
      content: JSON.stringify([{ type: "text", text: "Hello" }]),
    };
    const result = createUIMessage(msg);

    expect(result.id).toBe("msg-1");
    expect(result.role).toBe("assistant");
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual({ type: "text", text: "Hello" });
  });

  it("creates UIMessage from persisted message with plain text", () => {
    const msg = {
      id: "msg-2",
      role: "user",
      content: "Hello world",
    };
    const result = createUIMessage(msg);

    expect(result.id).toBe("msg-2");
    expect(result.role).toBe("user");
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual({ type: "text", text: "Hello world" });
  });
});

describe("persistedToUIMessagesBase", () => {
  it("converts array of persisted messages", () => {
    const messages = [
      { id: "1", role: "user", content: "Question" },
      {
        id: "2",
        role: "assistant",
        content: JSON.stringify([
          { type: "text", text: "Answer" },
          { type: "tool-search", output: { results: [] } },
        ]),
      },
    ];
    const result = persistedToUIMessagesBase(messages);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("1");
    expect(result[0].parts[0]).toEqual({ type: "text", text: "Question" });
    expect(result[1].id).toBe("2");
    expect(result[1].parts).toHaveLength(2);
    expect(result[1].parts[0]).toEqual({ type: "text", text: "Answer" });
    expect(result[1].parts[1]).toMatchObject({ type: "tool-search" });
  });

  it("handles empty array", () => {
    const result = persistedToUIMessagesBase([]);
    expect(result).toHaveLength(0);
  });
});
