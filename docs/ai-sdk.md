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

### Using `useChat`

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

## Key Files

| File | Purpose |
|------|---------|
| `/src/lib/chat/index.ts` | Core chat helpers, `createChatResponse`, `createTool` |
| `/src/lib/chat/skills.ts` | Skill loading and manifest |
| `/src/lib/chat/tools.ts` | Issue and planning tool definitions |
| `/src/app/api/chat/*/route.ts` | API route handlers |

## Related Documentation

- [Skills System](./skills.md) - Creating reusable AI instruction sets
- [MCP Integration](./mcp-integration.md) - Adding external tool servers
