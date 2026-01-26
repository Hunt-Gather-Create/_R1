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

export type UpdateDescriptionInput = z.infer<typeof updateDescriptionSchema>;
export type AttachContentInput = z.infer<typeof attachContentSchema>;
export type PlanIssueInput = z.infer<typeof planIssueSchema>;
export type SuggestIssueInput = z.infer<typeof suggestIssueSchema>;
