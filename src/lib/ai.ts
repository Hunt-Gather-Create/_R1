import { generateObject } from "ai";
import { z } from "zod";

// Default model - use Haiku for cost efficiency
// See: https://vercel.com/ai-gateway/models
export const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";

export const userStorySchema = z.object({
  stories: z.array(
    z.object({
      story: z.string().describe("The user story in standard format"),
      acceptanceCriteria: z
        .array(z.string())
        .describe("List of acceptance criteria for this story"),
    })
  ),
});

export type UserStories = z.infer<typeof userStorySchema>;

export async function generateUserStories(
  cardTitle: string,
  cardDescription: string | null
): Promise<UserStories> {
  const { object } = await generateObject({
    model: DEFAULT_MODEL,
    schema: userStorySchema,
    prompt: `Break down the following kanban card into user stories with acceptance criteria.

Card Title: ${cardTitle}
${cardDescription ? `Card Description: ${cardDescription}` : ""}

Generate clear, actionable user stories in the format "As a [user], I want [goal], so that [benefit]".
Each story should have specific, testable acceptance criteria.`,
  });

  return object;
}
