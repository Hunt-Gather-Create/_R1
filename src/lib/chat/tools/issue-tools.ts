import { tool } from "ai";
import { createTool } from "../index";
import {
  updateDescriptionSchema,
  attachContentSchema,
  listAttachmentsSchema,
  readAttachmentSchema,
  deleteAttachmentSchema,
  suggestAITasksSchema,
  updateSubtaskSchema,
  deleteSubtaskSchema,
} from "./schemas";
import { attachContentToIssue, getIssueAttachmentMetadata, getAttachmentsForIssues, getAttachment, deleteAttachment } from "@/lib/actions/attachments";
import { getIssueSubtasks } from "@/lib/actions/issues";
import { getContent } from "@/lib/storage/r2-client";
import { addAISuggestions, dismissAllAISuggestions } from "@/lib/actions/ai-suggestions";
import { updateIssue, deleteIssue } from "@/lib/actions/issues";
import type { ToolSet } from "ai";
import type { Priority } from "@/lib/design-tokens";

/**
 * Context needed for issue-specific tools
 */
export interface IssueToolsContext {
  issueId: string;
}

/**
 * Create tools for the issue chat
 * Tools are created dynamically because they need the issue ID
 */
export function createIssueTools(context: IssueToolsContext): ToolSet {
  return {
    updateDescription: createTool({
      description:
        "Update the issue description with refined content. Use this when you have a clear, improved description ready.",
      schema: updateDescriptionSchema,
      resultMessage: (input) =>
        `Description updated to: "${input.description.substring(0, 50)}..."`,
    }),

    attachContent: tool({
      description:
        "Attach generated content (guides, reports, code, analysis) to the issue as a file. Use this when you've created substantial content that should be saved as an attachment for future reference.",
      inputSchema: attachContentSchema,
      execute: async ({
        content,
        filename,
        mimeType,
      }: {
        content: string;
        filename: string;
        mimeType?: string;
      }) => {
        try {
          const attachment = await attachContentToIssue(
            context.issueId,
            content,
            filename,
            mimeType || "text/markdown"
          );
          return `Attached "${attachment.filename}" (${attachment.size} bytes) to the issue.`;
        } catch (error) {
          console.error("[attachContent] Error:", error);
          return `Failed to attach content: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    listAttachments: tool({
      description:
        "List all attachments on this issue. Optionally include attachments from subtasks. Use this to see what files and AI-generated outputs are available before reading them.",
      inputSchema: listAttachmentsSchema,
      execute: async ({
        includeSubtasks = false,
      }: {
        includeSubtasks?: boolean;
      }) => {
        try {
          type AttachmentEntry = { id: string; filename: string; mimeType: string; size: number; createdAt: Date };
          const results: Array<{ source: string; attachments: AttachmentEntry[] }> = [];

          if (includeSubtasks) {
            // Batch: fetch subtasks + all attachments in two queries (no N+1)
            const subtasks = await getIssueSubtasks(context.issueId);
            const allIssueIds = [context.issueId, ...subtasks.map((s) => s.id)];
            const allAttachments = await getAttachmentsForIssues(allIssueIds);

            // Group by issueId
            const byIssue = new Map<string, AttachmentEntry[]>();
            for (const a of allAttachments) {
              const list = byIssue.get(a.issueId) ?? [];
              list.push({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, createdAt: a.createdAt });
              byIssue.set(a.issueId, list);
            }

            const issueGroup = byIssue.get(context.issueId);
            if (issueGroup) {
              results.push({ source: "This issue", attachments: issueGroup });
            }

            for (const subtask of subtasks) {
              const group = byIssue.get(subtask.id);
              if (group) {
                results.push({ source: `Subtask: ${subtask.identifier} - ${subtask.title}`, attachments: group });
              }
            }
          } else {
            const issueAttachments = await getIssueAttachmentMetadata(context.issueId);
            if (issueAttachments.length > 0) {
              results.push({
                source: "This issue",
                attachments: issueAttachments.map((a) => ({
                  id: a.id,
                  filename: a.filename,
                  mimeType: a.mimeType,
                  size: a.size,
                  createdAt: a.createdAt,
                })),
              });
            }
          }

          if (results.length === 0) {
            return includeSubtasks
              ? "No attachments found on this issue or its subtasks."
              : "No attachments found on this issue.";
          }

          return JSON.stringify(results, null, 2);
        } catch (error) {
          console.error("[listAttachments] Error:", error);
          return `Failed to list attachments: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    readAttachment: tool({
      description:
        "Read the content of a text-based attachment (markdown, text, code, JSON, etc.). Use listAttachments first to find the attachment ID. This is essential for referencing outputs from AI subtasks.",
      inputSchema: readAttachmentSchema,
      execute: async ({ attachmentId }: { attachmentId: string }) => {
        try {
          const attachment = await getAttachment(attachmentId);
          if (!attachment) {
            return "Attachment not found.";
          }

          // Only read text-based attachments
          const textTypes = [
            "text/",
            "application/json",
            "application/xml",
            "application/javascript",
            "application/x-javascript",
            "application/x-yaml",
            "application/x-sh",
            "application/x-shellscript",
            "application/x-python",
            "application/x-ruby",
            "application/x-php",
            "application/x-csh",
            "application/xhtml+xml",
          ];
          const isText = textTypes.some((t) => attachment.mimeType.startsWith(t));
          if (!isText) {
            return `Cannot read binary attachment "${attachment.filename}" (${attachment.mimeType}). Only text-based files can be read.`;
          }

          const content = await getContent(attachment.storageKey);
          if (!content) {
            return `Attachment "${attachment.filename}" exists but has no content.`;
          }

          // Truncate very large files
          const maxLength = 15000;
          const truncated = content.length > maxLength;
          const displayContent = truncated
            ? content.substring(0, maxLength) + "\n\n[Content truncated - showing first 15,000 characters]"
            : content;

          return `## ${attachment.filename}\n\n${displayContent}`;
        } catch (error) {
          console.error("[readAttachment] Error:", error);
          return `Failed to read attachment: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    deleteAttachment: tool({
      description:
        "Delete an attachment from this issue. Use listAttachments first to find the attachment ID. Useful for removing outdated AI-generated outputs before re-attaching updated content.",
      inputSchema: deleteAttachmentSchema,
      execute: async ({ attachmentId, reason }: { attachmentId: string; reason?: string }) => {
        try {
          const attachment = await getAttachment(attachmentId);
          if (!attachment) {
            return "Attachment not found.";
          }

          const filename = attachment.filename;
          await deleteAttachment(attachmentId);
          return `Deleted attachment "${filename}"${reason ? ` (${reason})` : ""}.`;
        } catch (error) {
          console.error("[deleteAttachment] Error:", error);
          return `Failed to delete attachment: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    suggestAITasks: tool({
      description:
        "Suggest AI tasks that can be performed for this issue. These appear as 'ghost' subtasks that users can add. Use this to proactively suggest helpful tasks based on the issue context and available tools. By default, this replaces any existing suggestions.",
      inputSchema: suggestAITasksSchema,
      execute: async ({
        suggestions,
        replaceExisting = true,
      }: {
        suggestions: Array<{
          title: string;
          description?: string;
          priority?: number;
          toolsRequired?: string[];
        }>;
        replaceExisting?: boolean;
      }) => {
        try {
          if (suggestions.length === 0) {
            return "No suggestions provided.";
          }

          // Clear existing suggestions if replaceExisting is true
          if (replaceExisting) {
            await dismissAllAISuggestions(context.issueId);
          }

          const added = await addAISuggestions(context.issueId, suggestions);
          const action = replaceExisting ? "Replaced with" : "Added";
          return `${action} ${added.length} AI task suggestion${added.length > 1 ? "s" : ""}: ${added.map((s) => s.title).join(", ")}`;
        } catch (error) {
          console.error("[suggestAITasks] Error:", error);
          return `Failed to add suggestions: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    updateSubtask: tool({
      description:
        "Update an existing subtask's title, description, or priority. Use this when the user wants to modify existing subtasks, or when you need to fix subtasks that have issues (e.g., making them independent/parallel instead of sequential).",
      inputSchema: updateSubtaskSchema,
      execute: async ({
        subtaskId,
        title,
        description,
        priority,
      }: {
        subtaskId: string;
        title?: string;
        description?: string;
        priority?: number;
      }) => {
        try {
          const updates: { title?: string; description?: string; priority?: Priority } = {};
          if (title !== undefined) updates.title = title;
          if (description !== undefined) updates.description = description;
          if (priority !== undefined) updates.priority = priority as Priority;

          if (Object.keys(updates).length === 0) {
            return "No updates provided.";
          }

          await updateIssue(subtaskId, updates);
          const changedFields = Object.keys(updates).join(", ");
          return `Updated subtask (${changedFields})${title ? `: "${title}"` : ""}`;
        } catch (error) {
          console.error("[updateSubtask] Error:", error);
          return `Failed to update subtask: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),

    deleteSubtask: tool({
      description:
        "Delete an existing subtask. Use this when a subtask is no longer needed, is redundant, or should be replaced with better alternatives.",
      inputSchema: deleteSubtaskSchema,
      execute: async ({
        subtaskId,
        reason,
      }: {
        subtaskId: string;
        reason?: string;
      }) => {
        try {
          await deleteIssue(subtaskId);
          return `Deleted subtask${reason ? ` (${reason})` : ""}`;
        } catch (error) {
          console.error("[deleteSubtask] Error:", error);
          return `Failed to delete subtask: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
      },
    }),
  };
}
