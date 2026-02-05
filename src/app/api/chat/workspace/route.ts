import { type UIMessage, tool } from "ai";
import { z } from "zod";
import { createChatResponse, loadSkillsForWorkspace, buildContextualSystemPrompt, createMemoryTools } from "@/lib/chat";
import {
  createChatAttachment,
  getChatAttachment,
  getChatAttachments,
} from "@/lib/actions/workspace-chat";
import type { WorkspacePurpose } from "@/lib/design-tokens";
import type { WorkspaceSoul, Brand, WorkspaceMemory } from "@/lib/types";
import { loadWorkspaceContext } from "@/lib/brand-utils";
import { createSkillTools } from "@/lib/chat/tools/skill-creator-tool";
import { getLastUserMessageText } from "@/lib/memory-utils";

export const maxDuration = 30;

const SOFTWARE_SYSTEM_PROMPT = `You are a helpful AI assistant for a software development workspace. You can help with:

1. **Planning & Strategy**: Discuss project architecture, feature planning, and technical decisions
2. **Research**: Search for documentation, best practices, APIs, and technologies
3. **Problem Solving**: Debug issues, brainstorm solutions, and analyze technical approaches
4. **Code Generation**: Generate code snippets, configurations, and examples
5. **Documentation**: Help write technical documentation and specifications

**Available tools:**
- Web search: Research technologies, APIs, documentation, and best practices
- Code execution: Run calculations, generate code examples, analyze data
- Web fetch: Read documentation from URLs
- Create file: Save generated content (guides, code, documentation) as a file attachment
- List files: List all files created in this conversation
- Read file: Read the contents of a previously created file attachment
- Create skill: Save a repeatable workflow or instruction set as a reusable skill for this workspace
- Update skill: Modify an existing skill (requires user confirmation since it affects all users)

When you generate substantial content like documentation, guides, code files, or analysis reports, use the createFile tool to save it as an attachment so the user can easily access and download it.

If the user asks you to read or review a file, first use listFiles to see what files exist, then use readFile with the attachment ID.

When the user wants to save a repeatable workflow, instruction set, or specialized capability, use the create_skill tool. Skills need a name (lowercase with hyphens), description, and markdown content with instructions.

When updating a skill, ALWAYS warn the user first that the change will affect all users in the workspace and get their explicit confirmation before proceeding.

Be conversational and helpful. Provide clear, actionable responses.`;

const MARKETING_SYSTEM_PROMPT = `You are a helpful AI assistant for a marketing workspace. You can help with:

1. **Campaign Planning**: Discuss campaign strategies, target audiences, and marketing channels
2. **Research**: Search for market trends, competitor analysis, and industry insights
3. **Content Ideas**: Brainstorm content topics, headlines, and creative concepts
4. **Analysis**: Review marketing data, calculate ROI, and analyze performance metrics
5. **Copywriting**: Help draft marketing copy, emails, and social media content

**Available tools:**
- Web search: Research trends, competitors, audience insights, and best practices
- Code execution: Run calculations, analyze data, and create projections
- Web fetch: Read content from URLs and analyze landing pages
- Create file: Save generated content (reports, copy, briefs) as a file attachment
- List files: List all files created in this conversation
- Read file: Read the contents of a previously created file attachment
- Create skill: Save a repeatable workflow or instruction set as a reusable skill for this workspace
- Update skill: Modify an existing skill (requires user confirmation since it affects all users)

When you generate substantial content like marketing briefs, reports, or copy documents, use the createFile tool to save it as an attachment so the user can easily access and download it.

If the user asks you to read or review a file, first use listFiles to see what files exist, then use readFile with the attachment ID.

When the user wants to save a repeatable workflow, instruction set, or specialized capability, use the create_skill tool. Skills need a name (lowercase with hyphens), description, and markdown content with instructions.

When updating a skill, ALWAYS warn the user first that the change will affect all users in the workspace and get their explicit confirmation before proceeding.

Be conversational and helpful. Provide clear, actionable responses.`;

function getSystemPrompt(
  purpose: WorkspacePurpose,
  soul: WorkspaceSoul | null,
  brand: Brand | null,
  memories: WorkspaceMemory[] = []
): string {
  const basePrompt = purpose === "marketing"
    ? MARKETING_SYSTEM_PROMPT
    : SOFTWARE_SYSTEM_PROMPT;

  return buildContextualSystemPrompt(basePrompt, soul, brand, memories);
}

const createFileSchema = z.object({
  filename: z
    .string()
    .describe(
      "The filename with extension (e.g., 'implementation-guide.md', 'analysis-report.md', 'api-spec.yaml')"
    ),
  content: z.string().describe("The content to save in the file"),
  mimeType: z
    .string()
    .optional()
    .describe("MIME type (defaults to 'text/markdown')"),
});

const readFileSchema = z.object({
  attachmentId: z
    .string()
    .describe(
      "The ID of the attachment to read. This is the attachmentId returned when the file was created."
    ),
});

function createWorkspaceChatTools(chatId: string) {
  return {
    createFile: tool({
      description:
        "Create a file attachment with generated content. Use this when you've created substantial content (documentation, guides, code, reports, analysis) that the user should be able to view, copy, or download. The file will be attached to the conversation.",
      inputSchema: createFileSchema,
      execute: async ({
        filename,
        content,
        mimeType,
      }: {
        filename: string;
        content: string;
        mimeType?: string;
      }) => {
        try {
          const attachment = await createChatAttachment(
            chatId,
            filename,
            content,
            mimeType || "text/markdown"
          );
          return {
            success: true,
            attachmentId: attachment.id,
            filename: attachment.filename,
            size: attachment.size,
          };
        } catch (error) {
          console.error("[createFile] Error:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    }),
    readFile: tool({
      description:
        "Read the contents of a previously created file attachment. Use this when the user asks you to read, review, or analyze a file that was created earlier in the conversation.",
      inputSchema: readFileSchema,
      execute: async ({ attachmentId }: { attachmentId: string }) => {
        try {
          const attachment = await getChatAttachment(attachmentId);
          // Verify attachment exists and belongs to this chat
          if (!attachment || attachment.chatId !== chatId) {
            return {
              success: false,
              error: "Attachment not found",
            };
          }
          return {
            success: true,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
            content: attachment.content,
          };
        } catch (error) {
          console.error("[readFile] Error:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    }),
    listFiles: tool({
      description:
        "List all files that have been created in this conversation. Use this to find out what files exist before reading them.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const attachments = await getChatAttachments(chatId);
          return {
            success: true,
            files: attachments.map((a) => ({
              attachmentId: a.id,
              filename: a.filename,
              mimeType: a.mimeType,
              size: a.size,
              createdAt: a.createdAt,
            })),
            count: attachments.length,
          };
        } catch (error) {
          console.error("[listFiles] Error:", error);
          return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      },
    }),
  };
}

export async function POST(req: Request) {
  const { messages, workspacePurpose, workspaceId, chatId } =
    (await req.json()) as {
      messages: UIMessage[];
      workspacePurpose?: WorkspacePurpose;
      workspaceId?: string;
      chatId?: string;
    };

  const purpose = workspacePurpose ?? "software";

  // Extract last user message for memory search
  const lastUserMessage = getLastUserMessageText(messages);

  // Load workspace context (soul, brand, and memories) in parallel
  const { soul, brand, memories } = await loadWorkspaceContext(workspaceId, lastUserMessage);

  // Load workspace skills and MCP tools
  const skills = workspaceId
    ? await loadSkillsForWorkspace(workspaceId, purpose)
    : [];

  // Create tools - attachment tools if chatId, memory tools and skill tools if workspaceId
  const attachmentTools = chatId ? createWorkspaceChatTools(chatId) : {};
  const memoryTools = workspaceId ? createMemoryTools({ workspaceId }) : {};
  const skillTools = createSkillTools(workspaceId);
  const tools = { ...attachmentTools, ...memoryTools, ...skillTools };

  return createChatResponse(messages, {
    system: getSystemPrompt(purpose, soul, brand, memories),
    tools,
    builtInTools: {
      webSearch: true,
      codeExecution: true,
      webFetch: true,
    },
    skills,
    workspaceId,
    usageSource: "workspace",
  });
}
