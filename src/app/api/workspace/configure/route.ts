import { type UIMessage, tool } from "ai";
import { z } from "zod";
import { createChatResponse } from "@/lib/chat";
import { getCurrentUserId } from "@/lib/auth";
import { NextResponse } from "next/server";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are helping a user set up a custom kanban workspace. Your job is to understand what they want to use the workspace for and configure appropriate columns, labels, and starter issues.

**Your capabilities:**
- Configure workflow columns (the stages work moves through)
- Set up labels for categorizing work
- Suggest starter issues to help them get started

**Additional tools (use only when explicitly requested by the user):**
- Web search: Search the web for information. Only use when the user asks you to search or look something up.
- Code execution: Run code to help with calculations or data processing. Only use when the user asks you to run or execute code.
- Web fetch: Fetch content from a specific URL. Only use when the user provides a URL and asks you to read it.

**Guidelines for columns:**
- Suggest 3-6 columns that represent stages of their workflow
- Name columns to match the user's domain (e.g., "Sourcing" for recruiting, "Ideation" for creative work)
- Each column can have a status mapping for auto-move behavior:
  - backlog: Initial holding area
  - todo: Ready to start
  - in_progress: Actively being worked on
  - done: Completed
  - canceled: Stopped/rejected
  - null: Manual-only (good for review/approval stages)

**Guidelines for labels:**
- Suggest relevant labels that help categorize work
- Use distinct colors (hex codes like #ef4444)
- Keep it to 3-6 useful labels

**Guidelines for starter issues:**
- After configuring columns, suggest 3-5 starter issues to help them get started
- Issues should be relevant to their workflow and domain
- Include a mix of setup/onboarding tasks and example real work items
- Keep titles concise and actionable
- Descriptions can provide more context but are optional

**Conversation flow:**
1. Ask what they want to use the workspace for
2. Once you understand their needs, use setColumns to configure the workflow
3. Use setLabels if relevant labels make sense
4. Use suggestIssues to add starter issues that help them hit the ground running
5. Confirm the setup and explain your choices briefly

Be conversational and helpful. After configuring, let them know they can ask to adjust anything.`;

const columnSchema = z.object({
  name: z.string().describe("Column name"),
  status: z
    .enum(["backlog", "todo", "in_progress", "done", "canceled"])
    .nullable()
    .describe("Status mapping for auto-move, or null for manual-only"),
});

const labelSchema = z.object({
  name: z.string().describe("Label name"),
  color: z.string().describe("Hex color code (e.g., #ef4444)"),
});

const setColumnsSchema = z.object({
  columns: z
    .array(columnSchema)
    .min(2)
    .max(8)
    .describe("The workflow columns in order from left to right"),
});

const addColumnSchema = z.object({
  name: z.string().describe("Column name"),
  status: z
    .enum(["backlog", "todo", "in_progress", "done", "canceled"])
    .nullable()
    .describe("Status mapping"),
  position: z
    .number()
    .optional()
    .describe("Position to insert (0-indexed). Defaults to end."),
});

const removeColumnSchema = z.object({
  index: z.number().describe("Index of column to remove (0-indexed)"),
});

const updateColumnSchema = z.object({
  index: z.number().describe("Index of column to update (0-indexed)"),
  name: z.string().optional().describe("New name"),
  status: z
    .enum(["backlog", "todo", "in_progress", "done", "canceled"])
    .nullable()
    .optional()
    .describe("New status mapping"),
});

const setLabelsSchema = z.object({
  labels: z
    .array(labelSchema)
    .max(8)
    .describe("Labels for categorizing work"),
});

// Issue schemas
const issueSchema = z.object({
  title: z.string().describe("Issue title - concise and actionable"),
  description: z.string().optional().describe("Optional description with more context"),
});

const suggestIssuesSchema = z.object({
  issues: z
    .array(issueSchema)
    .max(10)
    .describe("Starter issues to help get started with the workspace"),
});

const addIssueSchema = z.object({
  title: z.string().describe("Issue title"),
  description: z.string().optional().describe("Optional description"),
});

const removeIssueSchema = z.object({
  index: z.number().describe("Index of issue to remove (0-indexed)"),
});

const updateIssueSchema = z.object({
  index: z.number().describe("Index of issue to update (0-indexed)"),
  title: z.string().optional().describe("New title"),
  description: z.string().optional().describe("New description"),
});

function createConfigurationTools() {
  return {
    setColumns: tool({
      description:
        "Set the workflow columns for the workspace. This replaces any existing columns. Use this when you've determined the appropriate workflow stages.",
      inputSchema: setColumnsSchema,
      execute: async ({ columns }) => ({
        success: true,
        action: "setColumns",
        columns,
      }),
    }),
    addColumn: tool({
      description: "Add a single column to the workspace.",
      inputSchema: addColumnSchema,
      execute: async ({ name, status, position }) => ({
        success: true,
        action: "addColumn",
        column: { name, status },
        position,
      }),
    }),
    removeColumn: tool({
      description: "Remove a column by its index.",
      inputSchema: removeColumnSchema,
      execute: async ({ index }) => ({
        success: true,
        action: "removeColumn",
        index,
      }),
    }),
    updateColumn: tool({
      description: "Update a column's name or status mapping.",
      inputSchema: updateColumnSchema,
      execute: async ({ index, name, status }) => ({
        success: true,
        action: "updateColumn",
        index,
        updates: { name, status },
      }),
    }),
    setLabels: tool({
      description:
        "Set the labels for categorizing work. This replaces any existing labels.",
      inputSchema: setLabelsSchema,
      execute: async ({ labels }) => ({
        success: true,
        action: "setLabels",
        labels,
      }),
    }),
    suggestIssues: tool({
      description:
        "Suggest starter issues to help the user get started with their workspace. Call this after setting up columns.",
      inputSchema: suggestIssuesSchema,
      execute: async ({ issues }) => ({
        success: true,
        action: "suggestIssues",
        issues,
      }),
    }),
    addIssue: tool({
      description: "Add a single starter issue.",
      inputSchema: addIssueSchema,
      execute: async ({ title, description }) => ({
        success: true,
        action: "addIssue",
        issue: { title, description },
      }),
    }),
    removeIssue: tool({
      description: "Remove a starter issue by its index.",
      inputSchema: removeIssueSchema,
      execute: async ({ index }) => ({
        success: true,
        action: "removeIssue",
        index,
      }),
    }),
    updateIssue: tool({
      description: "Update a starter issue's title or description.",
      inputSchema: updateIssueSchema,
      execute: async ({ index, title, description }) => ({
        success: true,
        action: "updateIssue",
        index,
        updates: { title, description },
      }),
    }),
  };
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messages, currentConfig } = (await req.json()) as {
    messages: UIMessage[];
    currentConfig?: {
      columns: Array<{ name: string; status: string | null }>;
      labels: Array<{ name: string; color: string }>;
      issues: Array<{ title: string; description?: string }>;
    };
  };

  // Build context about current configuration
  let configContext = "";
  if (currentConfig) {
    const columnsDesc =
      currentConfig.columns.length > 0
        ? currentConfig.columns
            .map(
              (c, i) =>
                `${i + 1}. "${c.name}" (status: ${c.status || "none"})`
            )
            .join("\n")
        : "No columns configured yet";

    const labelsDesc =
      currentConfig.labels.length > 0
        ? currentConfig.labels.map((l) => `"${l.name}" (${l.color})`).join(", ")
        : "No labels configured yet";

    const issuesDesc =
      currentConfig.issues.length > 0
        ? currentConfig.issues
            .map((issue, i) => `${i + 1}. "${issue.title}"`)
            .join("\n")
        : "No starter issues yet";

    configContext = `\n\n**Current workspace configuration:**
Columns:
${columnsDesc}

Labels: ${labelsDesc}

Starter Issues:
${issuesDesc}`;
  }

  const tools = createConfigurationTools();

  return createChatResponse(messages, {
    system: SYSTEM_PROMPT + configContext,
    tools,
    maxSteps: 5,
    builtInTools: {
      webSearch: true,
      codeExecution: true,
      webFetch: true,
    },
  });
}
