import { z } from "zod";

/**
 * Schema for updating an issue description
 */
export const updateDescriptionSchema = z.object({
  description: z
    .string()
    .describe(
      "The updated description with acceptance criteria, user stories, or improved requirements"
    ),
});

/**
 * Schema for attaching content to an issue
 */
export const attachContentSchema = z.object({
  content: z
    .string()
    .describe("The content to attach (markdown, text, code, etc.)"),
  filename: z
    .string()
    .describe(
      "The filename for the attachment (e.g., 'optimization-guide.md', 'analysis.txt')"
    ),
  mimeType: z
    .string()
    .optional()
    .describe("MIME type (defaults to 'text/markdown')"),
});

/**
 * Schema for planning/suggesting an issue
 */
export const planIssueSchema = z.object({
  title: z
    .string()
    .describe("A clear, actionable title for the issue (max 100 characters)"),
  description: z
    .string()
    .describe(
      "Detailed description with acceptance criteria in markdown checkbox format"
    ),
  priority: z
    .number()
    .min(0)
    .max(4)
    .describe("Priority level: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None"),
});

/**
 * Schema for suggesting issue details (used in main chat)
 */
export const suggestIssueSchema = z.object({
  title: z
    .string()
    .describe("A clear, concise title for the issue (max 100 characters)"),
  description: z
    .string()
    .describe(
      "A detailed description, ideally in user story format: As a [user], I want [goal], so that [benefit]"
    ),
  priority: z
    .number()
    .min(0)
    .max(4)
    .describe("Priority level: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None"),
});

/**
 * Schema for suggesting AI tasks for an issue
 */
export const suggestAITasksSchema = z.object({
  suggestions: z
    .array(
      z.object({
        title: z
          .string()
          .describe("A clear, actionable task title that describes what AI should do"),
        description: z
          .string()
          .optional()
          .describe("Optional description with more context about the task"),
        priority: z
          .number()
          .min(0)
          .max(4)
          .optional()
          .describe("Priority: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None (default)"),
        toolsRequired: z
          .array(z.string())
          .optional()
          .describe(
            "List of tools the AI will need (e.g., 'web_search', 'code_execution', 'exa_search')"
          ),
      })
    )
    .describe("List of AI task suggestions for this issue"),
  replaceExisting: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true (default), removes existing suggestions before adding new ones"),
});

/**
 * Schema for updating an existing subtask
 */
export const updateSubtaskSchema = z.object({
  subtaskId: z
    .string()
    .describe("The ID of the subtask to update"),
  title: z
    .string()
    .optional()
    .describe("New title for the subtask"),
  description: z
    .string()
    .optional()
    .describe("New description for the subtask"),
  priority: z
    .number()
    .min(0)
    .max(4)
    .optional()
    .describe("New priority: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None"),
});

/**
 * Schema for deleting a subtask
 */
export const deleteSubtaskSchema = z.object({
  subtaskId: z
    .string()
    .describe("The ID of the subtask to delete"),
  reason: z
    .string()
    .optional()
    .describe("Optional reason for deletion (for user context)"),
});

/**
 * Schema for suggesting subtasks during issue creation
 */
export const suggestSubtasksSchema = z.object({
  subtasks: z
    .array(
      z.object({
        title: z
          .string()
          .describe("A clear, actionable subtask title"),
        description: z
          .string()
          .optional()
          .describe("Optional description with more context"),
        priority: z
          .number()
          .min(0)
          .max(4)
          .optional()
          .describe("Priority: 0=Urgent, 1=High, 2=Medium, 3=Low, 4=None (default)"),
      })
    )
    .describe("List of subtasks to break down the main issue"),
  replaceExisting: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true (default), removes existing subtasks before adding new ones. Set to false to append."),
});

/**
 * Schema for storing a new workspace memory
 */
export const storeMemorySchema = z.object({
  content: z
    .string()
    .describe(
      "The memory content to store. Be specific and include relevant context."
    ),
  tags: z
    .array(z.string())
    .describe(
      "Tags for categorizing and searching this memory (e.g., ['preference', 'workflow', 'contact'])"
    ),
});

/**
 * Schema for updating an existing workspace memory
 */
export const updateMemorySchema = z.object({
  memoryId: z.string().describe("The ID of the memory to update"),
  content: z
    .string()
    .optional()
    .describe("Updated content for the memory"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Updated tags for the memory"),
});

/**
 * Schema for deleting a workspace memory
 */
export const deleteMemorySchema = z.object({
  memoryId: z.string().describe("The ID of the memory to delete"),
});

/**
 * Schema for summarizing a planning session into an epic
 */
export const summarizeEpicSchema = z.object({
  title: z
    .string()
    .describe("A concise title for the epic (max 80 chars)"),
  description: z
    .string()
    .describe("A 2-3 sentence summary of the epic scope"),
});

export type SummarizeEpicInput = z.infer<typeof summarizeEpicSchema>;

/**
 * Schema for listing attachments on an issue
 */
export const listAttachmentsSchema = z.object({
  includeSubtasks: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, also list attachments from subtasks"),
});

/**
 * Schema for reading attachment content
 */
export const readAttachmentSchema = z.object({
  attachmentId: z
    .string()
    .describe("The ID of the attachment to read"),
});

/**
 * Schema for deleting an attachment
 */
export const deleteAttachmentSchema = z.object({
  attachmentId: z
    .string()
    .describe("The ID of the attachment to delete"),
  reason: z
    .string()
    .optional()
    .describe("Optional reason for deletion (for user context)"),
});

export type ListAttachmentsInput = z.infer<typeof listAttachmentsSchema>;
export type ReadAttachmentInput = z.infer<typeof readAttachmentSchema>;
export type DeleteAttachmentInput = z.infer<typeof deleteAttachmentSchema>;
export type UpdateDescriptionInput = z.infer<typeof updateDescriptionSchema>;
export type AttachContentInput = z.infer<typeof attachContentSchema>;
export type PlanIssueInput = z.infer<typeof planIssueSchema>;
export type SuggestIssueInput = z.infer<typeof suggestIssueSchema>;
export type SuggestAITasksInput = z.infer<typeof suggestAITasksSchema>;
export type SuggestSubtasksInput = z.infer<typeof suggestSubtasksSchema>;
export type UpdateSubtaskInput = z.infer<typeof updateSubtaskSchema>;
export type DeleteSubtaskInput = z.infer<typeof deleteSubtaskSchema>;
export type StoreMemoryInput = z.infer<typeof storeMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
export type DeleteMemoryInput = z.infer<typeof deleteMemorySchema>;

/**
 * Schema for creating a workspace skill
 */
export const createSkillSchema = z.object({
  name: z
    .string()
    .describe(
      "The skill name: lowercase, alphanumeric, hyphens only (e.g., 'simplify-for-kids', 'code-reviewer')"
    ),
  description: z
    .string()
    .describe(
      "A 1-2 sentence description explaining when to use this skill and what it does"
    ),
  content: z
    .string()
    .describe(
      "The full markdown instructions the AI follows when the skill is invoked"
    ),
});

export type CreateSkillInput = z.infer<typeof createSkillSchema>;

/**
 * Schema for updating an existing workspace skill
 */
export const updateSkillSchema = z.object({
  skillName: z
    .string()
    .describe("The exact name of the skill to update"),
  name: z
    .string()
    .optional()
    .describe("New name for the skill (lowercase, alphanumeric, hyphens only)"),
  description: z
    .string()
    .optional()
    .describe("New description for the skill"),
  content: z
    .string()
    .optional()
    .describe("New markdown instructions for the skill"),
  userConfirmed: z
    .boolean()
    .describe(
      "REQUIRED: Must be true. Before calling this tool, you MUST warn the user that updating this skill will affect ALL users in the workspace and get their explicit confirmation."
    ),
});

export type UpdateSkillInput = z.infer<typeof updateSkillSchema>;
