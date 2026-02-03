# AI SDK Integration

This guide covers the AI SDK patterns used in this codebase for building chat interfaces with tool calling.

## Package Versions

```json
{
  "@ai-sdk/anthropic": "^3.0.23",
  "@ai-sdk/mcp": "^1.0.13",
  "@ai-sdk/react": "^3.0.50",
  "ai": "^6.0.48"
}
```

**Official Documentation:** [sdk.vercel.ai/docs](https://sdk.vercel.ai/docs)

## Server-Side Patterns

The core chat logic lives in `/src/lib/chat/index.ts`.

### Creating a Chat Response

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool, convertToModelMessages, stepCountIs, type UIMessage } from "ai";

const result = streamText({
  model: anthropic("claude-sonnet-4-20250514"),
  system: "Your system prompt",
  messages: await convertToModelMessages(messages),
  tools: { /* your tools */ },
  stopWhen: stepCountIs(5), // Max tool call rounds
});

return result.toUIMessageStreamResponse();
```

### The `createChatResponse` Helper

Use the `createChatResponse` function from `/src/lib/chat/index.ts` to handle common setup:

```typescript
import { createChatResponse, loadSkillsForWorkspace } from "@/lib/chat";

export async function POST(req: Request) {
  const { messages, workspaceId } = await req.json();

  return createChatResponse(messages, {
    system: "Your system prompt",
    tools: { /* custom tools */ },
    builtInTools: {
      webSearch: true,
      codeExecution: true,
      webFetch: true,
    },
    skills: await loadSkillsForWorkspace(workspaceId, "software"),
    workspaceId, // Enables MCP tools from integrations
  });
}
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `system` | string | System prompt |
| `tools` | ToolSet | Custom tools |
| `model` | string | Model ID (default: `claude-sonnet-4-20250514`) |
| `maxSteps` | number | Max tool call rounds (default: 5) |
| `builtInTools` | object | Enable Anthropic built-in tools |
| `skills` | ParsedSkill[] | Skill instructions to include |
| `workspaceId` | string | Load MCP tools for this workspace |

## Built-in Anthropic Tools

Enable built-in tools via the `builtInTools` config:

```typescript
builtInTools: {
  webSearch: true,                    // or { maxUses: 3 }
  codeExecution: true,
  webFetch: true,                     // or { maxUses: 2 }
}
```

These map to:
- `anthropic.tools.webSearch_20250305()` - Web search
- `anthropic.tools.codeExecution_20250825()` - Python code execution
- `anthropic.tools.webFetch_20250910()` - Fetch URL content

## Creating Custom Tools

### Using `createTool` Helper

The `createTool` helper ensures tools return results to the AI:

```typescript
import { createTool } from "@/lib/chat";
import { z } from "zod";

const myTool = createTool({
  description: "What this tool does",
  schema: z.object({
    param: z.string().describe("Parameter description"),
  }),
  resultMessage: (input) => `Processed ${input.param}`, // Optional
});
```

### Using AI SDK `tool` Directly

For tools that need async execution:

```typescript
import { tool } from "ai";
import { z } from "zod";

const createFile = tool({
  description: "Create a file attachment",
  inputSchema: z.object({
    filename: z.string(),
    content: z.string(),
  }),
  execute: async ({ filename, content }) => {
    const result = await saveFile(filename, content);
    return { success: true, id: result.id };
  },
});
```

## Client-Side Patterns

### Unified Chat Architecture

The codebase uses a **hook + component pattern** for chat interfaces. This provides consistent behavior across all chat panels while allowing customization.

#### Core Building Blocks

| Module | Purpose |
|--------|---------|
| `useChatCore` | Hook that encapsulates transport, state, persistence, and auto-scroll |
| `ChatContainer` | Reusable UI component for chat layout |
| `message-persistence.ts` | Shared utilities for saving/loading messages |

### Using `useChatCore`

The `useChatCore` hook is the recommended way to build chat interfaces. It handles:
- Transport creation and memoization
- Loading states (`streaming`, `submitted`, `ready`)
- File attachment preparation
- Auto-scroll and auto-focus behavior
- Optional message persistence

```typescript
"use client";

import { useChatCore } from "@/lib/hooks";
import { ChatContainer } from "@/components/ai-elements/ChatContainer";

function MyChat() {
  const chat = useChatCore({
    api: "/api/chat/my-endpoint",
    transportBody: { workspaceId: "..." },
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName === "myTool") {
        // Handle tool call side effects
      }
    },
  });

  return (
    <ChatContainer
      messages={chat.messages}
      containerRef={chat.containerRef}
      textareaRef={chat.textareaRef}
      spacerHeight={chat.spacerHeight}
      isLoading={chat.isLoading}
      input={chat.input}
      onInputChange={chat.setInput}
      onSubmit={chat.handleSubmit}
      header={{ title: "AI Assistant" }}
      welcomeMessage="How can I help?"
    />
  );
}
```

#### `useChatCore` Options

| Option | Type | Description |
|--------|------|-------------|
| `api` | string | API endpoint for chat |
| `transportBody` | object | Additional data sent with each request |
| `onToolCall` | function | Called when AI invokes a tool |
| `persistence` | object | Optional persistence configuration (see below) |

#### `useChatCore` Return Value

| Property | Type | Description |
|----------|------|-------------|
| `messages` | UIMessage[] | Current chat messages |
| `isLoading` | boolean | True when streaming or submitted |
| `isLoadingHistory` | boolean | True when loading persisted messages |
| `input` | string | Current input text |
| `setInput` | function | Set input text |
| `files` | File[] | Attached files |
| `setFiles` | function | Set attached files |
| `handleSubmit` | function | Submit message with files |
| `handleClearHistory` | function | Clear all messages |
| `containerRef` | RefObject | Ref for scroll container |
| `textareaRef` | RefObject | Ref for input textarea |
| `spacerHeight` | number | Height for scroll spacer |

### Adding Persistence

To persist chat messages across page refreshes, provide a `persistence` config:

```typescript
import {
  useIssueChatMessages,
  useSaveChatMessage,
  useClearChatMessages
} from "@/lib/hooks";
import { persistedToUIMessagesBase, serializeMessageParts } from "@/lib/chat/message-persistence";

const chat = useChatCore({
  api: "/api/chat/issue",
  persistence: {
    entityId: issueId,
    useMessages: useIssueChatMessages,
    toUIMessages: persistedToUIMessagesBase,
    onSaveMessage: (message) => {
      saveChatMutation.mutate({
        role: message.role,
        content: serializeMessageParts(message.parts),
      });
    },
    onClearMessages: async () => {
      await clearChatMutation.mutateAsync();
    },
  },
});
```

#### Message Persistence Utilities

The `message-persistence.ts` module provides shared utilities:

```typescript
import {
  parseMessageParts,      // Parse JSON parts or plain text
  serializeMessageParts,  // Serialize parts to JSON
  persistedToUIMessagesBase, // Convert persisted messages to UIMessage[]
  createUIMessage,        // Create single UIMessage from persisted
} from "@/lib/chat/message-persistence";
```

**Important:** Messages are stored as JSON arrays to preserve tool calls. The utilities handle both the new JSON format and legacy plain text:

```typescript
// New format (preserves tool calls)
'[{"type":"text","text":"Hello"},{"type":"tool-search","output":{...}}]'

// Legacy format (plain text, auto-converted)
"Hello world"
```

### Using `ChatContainer`

The `ChatContainer` component provides a standard chat layout:

```typescript
<ChatContainer
  // Required props from useChatCore
  messages={chat.messages}
  containerRef={chat.containerRef}
  textareaRef={chat.textareaRef}
  spacerHeight={chat.spacerHeight}
  isLoading={chat.isLoading}
  input={chat.input}
  onInputChange={chat.setInput}
  onSubmit={chat.handleSubmit}

  // Optional customization
  header={{
    title: "AI Assistant",
    subtitle: "Powered by Claude",
    icon: <Sparkles className="w-4 h-4" />,
    showClearButton: true,
  }}
  onClearHistory={chat.handleClearHistory}
  welcomeMessage="How can I help you today?"
  inputPlaceholder="Type a message..."
  showAttachmentButton={true}
  files={chat.files}
  onFilesChange={chat.setFiles}
  isLoadingHistory={chat.isLoadingHistory}

  // Custom tool call rendering
  renderToolCall={(toolName, result, index) => {
    if (toolName === "updateDescription") {
      return <div key={index}>✨ Description updated</div>;
    }
    return null; // Falls back to ToolResultDisplay
  }}
/>
```

#### Tool Call Rendering

Tool calls appear in messages as parts with `type: "tool-{toolName}"`. The `ChatContainer` extracts the tool name and passes it to your `renderToolCall` function:

```typescript
renderToolCall={(toolName, result, index, part) => {
  // toolName: "fetchUrl", "webSearch", etc.
  // result: The tool's output
  // index: Part index for React key
  // part: Full part object if needed

  if (toolName === "webSearch") {
    return <SearchResultCard key={index} results={result} />;
  }

  // Return null to use default ToolResultDisplay
  return null;
}}
```

### Using `useChat` Directly

For simple cases or when you need more control, use `useChat` from `@ai-sdk/react` directly:

```typescript
"use client";

import { useChat } from "@ai-sdk/react";

function ChatComponent() {
  const { messages, input, handleInputChange, handleSubmit, status } = useChat({
    api: "/api/chat/workspace",
    body: {
      workspaceId: "...",
      chatId: "...",
    },
  });

  return (
    <form onSubmit={handleSubmit}>
      {messages.map((m) => (
        <div key={m.id}>{m.content}</div>
      ))}
      <input value={input} onChange={handleInputChange} />
    </form>
  );
}
```

### Handling Tool Calls

```typescript
const { messages } = useChat({
  api: "/api/chat",
  onToolCall: async ({ toolCall }) => {
    if (toolCall.toolName === "navigateToPage") {
      router.push(toolCall.args.path);
    }
  },
});
```

### File Attachments

Send files with messages using experimental attachments:

```typescript
const { handleSubmit } = useChat({
  api: "/api/chat",
});

// Convert File to attachment format
const attachments = files.map(file => ({
  name: file.name,
  contentType: file.type,
  url: URL.createObjectURL(file),
}));

handleSubmit(event, { experimental_attachments: attachments });
```

## Chat API Route Structure

Route files are in `/src/app/api/chat/*/route.ts`.

Example structure for a workspace chat:

```typescript
// /src/app/api/chat/workspace/route.ts
import { createChatResponse, loadSkillsForWorkspace } from "@/lib/chat";
import type { UIMessage } from "ai";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages, workspaceId, chatId } = await req.json() as {
    messages: UIMessage[];
    workspaceId?: string;
    chatId?: string;
  };

  const skills = workspaceId
    ? await loadSkillsForWorkspace(workspaceId, "software")
    : [];

  const tools = chatId ? createWorkspaceTools(chatId) : {};

  return createChatResponse(messages, {
    system: SYSTEM_PROMPT,
    tools,
    builtInTools: { webSearch: true, codeExecution: true, webFetch: true },
    skills,
    workspaceId,
  });
}
```

## Utility Hooks

### `useAutoFocusOnComplete`

Auto-focuses an input element when a loading state transitions from true to false. Useful for chat interfaces to focus the input after the AI finishes responding.

```typescript
import { useAutoFocusOnComplete } from "@/lib/hooks";

function ChatComponent() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { status } = useChat({ api: "/api/chat" });
  const isLoading = status === "streaming" || status === "submitted";

  // Focus input when AI finishes responding
  useAutoFocusOnComplete(isLoading, textareaRef);

  return <textarea ref={textareaRef} />;
}
```

## Key Files

| File | Purpose |
|------|---------|
| `/src/lib/chat/index.ts` | Core chat helpers, `createChatResponse`, `createTool` |
| `/src/lib/chat/message-persistence.ts` | Shared utilities for saving/loading chat messages |
| `/src/lib/chat/skills.ts` | Skill loading and manifest |
| `/src/lib/chat/tools/` | Tool definitions (issue, planning, schemas) |
| `/src/lib/hooks/use-chat-core.ts` | `useChatCore` hook for unified chat state |
| `/src/lib/hooks/use-auto-focus.ts` | `useAutoFocusOnComplete` hook |
| `/src/lib/hooks/use-chat-auto-scroll.ts` | Auto-scroll behavior for chat |
| `/src/components/ai-elements/ChatContainer.tsx` | Reusable chat UI layout |
| `/src/components/ai-elements/ChatMessageItem.tsx` | Individual message rendering |
| `/src/components/ai-elements/ToolResultDisplay.tsx` | Default tool result display |
| `/src/app/api/chat/*/route.ts` | API route handlers |

## Creating a New Chat Panel

Quick checklist for adding a new chat interface:

### 1. Create the API Route

```typescript
// /src/app/api/chat/my-feature/route.ts
import { createChatResponse } from "@/lib/chat";
import type { UIMessage } from "ai";

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages, ...context } = await req.json() as {
    messages: UIMessage[];
    // Add your context fields
  };

  return createChatResponse(messages, {
    system: "Your system prompt here",
    tools: { /* your tools */ },
  });
}
```

### 2. Create the Chat Component

```typescript
// /src/components/my-feature/MyChat.tsx
"use client";

import { useChatCore } from "@/lib/hooks";
import { ChatContainer } from "@/components/ai-elements/ChatContainer";

export function MyChat({ contextId }: { contextId: string }) {
  const chat = useChatCore({
    api: "/api/chat/my-feature",
    transportBody: { contextId },
  });

  return (
    <ChatContainer
      messages={chat.messages}
      containerRef={chat.containerRef}
      textareaRef={chat.textareaRef}
      spacerHeight={chat.spacerHeight}
      isLoading={chat.isLoading}
      input={chat.input}
      onInputChange={chat.setInput}
      onSubmit={chat.handleSubmit}
      header={{ title: "My Chat" }}
      welcomeMessage="How can I help?"
    />
  );
}
```

### 3. Add Persistence (Optional)

If messages should survive page refreshes:

1. Create database table/columns for messages
2. Create TanStack Query hooks (`useMyMessages`, `useSaveMyMessage`, etc.)
3. Add `persistence` config to `useChatCore`

### 4. Add Custom Tool Rendering (Optional)

```typescript
<ChatContainer
  // ... other props
  renderToolCall={(toolName, result, index) => {
    if (toolName === "myTool") {
      return <MyToolResult key={index} data={result} />;
    }
    return null; // Use default ToolResultDisplay
  }}
/>
```

## Related Documentation

- [Skills System](./skills.md) - Creating reusable AI instruction sets
- [MCP Integration](./mcp-integration.md) - Adding external tool servers
