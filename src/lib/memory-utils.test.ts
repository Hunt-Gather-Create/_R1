import { describe, it, expect } from "vitest";
import type { UIMessage } from "ai";
import { buildMemorySystemPrompt, getLastUserMessageText } from "./memory-utils";
import type { WorkspaceMemory } from "./types";

// Factory helper for creating test memories
function createMemory(overrides: Partial<WorkspaceMemory> = {}): WorkspaceMemory {
  return {
    id: "memory-1",
    workspaceId: "workspace-1",
    content: "Test memory content",
    tags: JSON.stringify(["test", "preference"]),
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

describe("buildMemorySystemPrompt", () => {
  it("returns empty string when memories array is empty", () => {
    const result = buildMemorySystemPrompt([]);
    expect(result).toBe("");
  });

  it("formats single memory correctly", () => {
    const memories = [
      createMemory({
        content: "User prefers dark mode",
        tags: JSON.stringify(["preference", "ui"]),
      }),
    ];
    const result = buildMemorySystemPrompt(memories);

    expect(result).toContain("## Workspace Memories");
    expect(result).toContain("- User prefers dark mode [preference, ui]");
    expect(result).toContain("Use these memories to provide more personalized");
  });

  it("formats multiple memories correctly", () => {
    const memories = [
      createMemory({
        id: "m1",
        content: "User's timezone is PST",
        tags: JSON.stringify(["timezone"]),
      }),
      createMemory({
        id: "m2",
        content: "Project deadline is Friday",
        tags: JSON.stringify(["project", "deadline"]),
      }),
    ];
    const result = buildMemorySystemPrompt(memories);

    expect(result).toContain("- User's timezone is PST [timezone]");
    expect(result).toContain("- Project deadline is Friday [project, deadline]");
  });

  it("handles memory with empty tags array", () => {
    const memories = [
      createMemory({
        content: "Some memory without tags",
        tags: JSON.stringify([]),
      }),
    ];
    const result = buildMemorySystemPrompt(memories);

    expect(result).toContain("- Some memory without tags");
    expect(result).not.toContain("[]"); // Should not show empty brackets
  });
});

describe("getLastUserMessageText", () => {
  // Helper to create UIMessage-like objects for testing
  function createMessage(role: "user" | "assistant", parts: UIMessage["parts"]): UIMessage {
    return {
      id: crypto.randomUUID(),
      role,
      parts,
    } as UIMessage;
  }

  it("returns undefined for empty messages array", () => {
    const result = getLastUserMessageText([]);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no user messages exist", () => {
    const messages = [
      createMessage("assistant", [{ type: "text", text: "Hello!" }]),
      createMessage("assistant", [{ type: "text", text: "How can I help?" }]),
    ];
    const result = getLastUserMessageText(messages);
    expect(result).toBeUndefined();
  });

  it("returns text from message parts", () => {
    const messages = [
      createMessage("user", [{ type: "text", text: "What is my favorite color?" }]),
    ];
    const result = getLastUserMessageText(messages);
    expect(result).toBe("What is my favorite color?");
  });

  it("returns the last user message when multiple exist", () => {
    const messages = [
      createMessage("user", [{ type: "text", text: "First question" }]),
      createMessage("assistant", [{ type: "text", text: "First answer" }]),
      createMessage("user", [{ type: "text", text: "Second question" }]),
      createMessage("assistant", [{ type: "text", text: "Second answer" }]),
      createMessage("user", [{ type: "text", text: "Third question" }]),
    ];
    const result = getLastUserMessageText(messages);
    expect(result).toBe("Third question");
  });

  it("joins multiple text parts", () => {
    const messages = [
      createMessage("user", [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ]),
    ];
    const result = getLastUserMessageText(messages);
    expect(result).toBe("Hello  world");
  });

  it("filters out non-text parts", () => {
    const messages = [
      createMessage("user", [
        { type: "image", image: "https://example.com/img.png" } as unknown as UIMessage["parts"][0],
        { type: "text", text: "What is this?" },
      ]),
    ];
    const result = getLastUserMessageText(messages);
    expect(result).toBe("What is this?");
  });

  it("returns undefined when message has no text parts", () => {
    const messages = [
      createMessage("user", [
        { type: "image", image: "https://example.com/img.png" } as unknown as UIMessage["parts"][0],
      ]),
    ];
    const result = getLastUserMessageText(messages);
    expect(result).toBeUndefined();
  });
});
