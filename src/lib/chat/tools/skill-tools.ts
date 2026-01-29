import { tool } from "ai";
import { z } from "zod";
import type { ParsedSkill } from "../skills";

/**
 * Schema for loading a skill
 */
export const loadSkillSchema = z.object({
  skillName: z.string().describe("The exact name of the skill to load"),
});

export type LoadSkillInput = z.infer<typeof loadSkillSchema>;

/**
 * Create a tool that loads full skill instructions on demand.
 * This enables lazy loading of skills - only the skill summaries are included
 * in the system prompt, and full instructions are loaded when needed.
 */
export function createSkillLoaderTool(skills: ParsedSkill[]) {
  return tool({
    description:
      "Load full instructions for a skill when the user request matches its description. Call this before following skill instructions.",
    inputSchema: loadSkillSchema,
    execute: async ({ skillName }) => {
      const skill = skills.find(
        (s) => s.name.toLowerCase() === skillName.toLowerCase()
      );
      if (!skill) {
        return `Skill "${skillName}" not found. Available skills: ${skills.map((s) => s.name).join(", ")}`;
      }
      return `# ${skill.name} Instructions\n\n${skill.content}`;
    },
  });
}
