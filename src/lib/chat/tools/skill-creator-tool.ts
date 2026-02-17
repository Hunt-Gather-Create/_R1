import { tool, type ToolSet } from "ai";
import { createSkillSchema, updateSkillSchema } from "./schemas";
import {
  createWorkspaceSkill,
  getWorkspaceSkills,
  updateWorkspaceSkill,
} from "@/lib/actions/skills";

/**
 * Normalize a skill name: lowercase, replace spaces with hyphens, remove invalid chars.
 * Valid characters: lowercase letters, numbers, and hyphens.
 */
export function normalizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

/**
 * Creates a tool that allows the AI to create new workspace skills.
 * Skills created through this tool are immediately available for use.
 */
export function createSkillCreatorTool(workspaceId: string) {
  return tool({
    description:
      "Create a new skill for this workspace. Use this when the user wants to save a repeatable workflow, instruction set, or specialized capability as a skill.",
    inputSchema: createSkillSchema,
    execute: async ({ name, description, content }) => {
      const normalizedName = normalizeSkillName(name);

      const skill = await createWorkspaceSkill(workspaceId, {
        name: normalizedName,
        description,
        content,
      });

      return {
        success: true,
        skillId: skill.id,
        skillName: skill.name,
        message: `Created skill "${skill.name}". It's now available for use via the load_skill tool.`,
      };
    },
  });
}

/**
 * Creates a tool that allows the AI to update existing workspace skills.
 * The AI must confirm with the user before updating since changes affect all users.
 */
export function createSkillUpdaterTool(workspaceId: string) {
  return tool({
    description:
      "Update an existing skill in this workspace. IMPORTANT: Before using this tool, you MUST warn the user that this will update the skill for ALL users in the workspace and get their explicit confirmation. Only proceed if userConfirmed is true.",
    inputSchema: updateSkillSchema,
    execute: async ({ skillName, name, description, content, userConfirmed }) => {
      // Enforce confirmation requirement
      if (!userConfirmed) {
        return {
          success: false,
          error:
            "User confirmation required. Please warn the user that updating this skill will affect ALL users in the workspace and ask for their explicit confirmation before proceeding.",
        };
      }

      // Find the skill by name
      const skills = await getWorkspaceSkills(workspaceId);
      const existingSkill = skills.find(
        (s) => s.name.toLowerCase() === skillName.toLowerCase()
      );

      if (!existingSkill) {
        return {
          success: false,
          error: `Skill "${skillName}" not found. Available skills: ${skills.map((s) => s.name).join(", ") || "none"}`,
        };
      }

      // Build update payload with only provided fields
      const updatePayload: { name?: string; description?: string; content?: string } = {};
      if (name !== undefined) {
        updatePayload.name = normalizeSkillName(name);
      }
      if (description !== undefined) {
        updatePayload.description = description;
      }
      if (content !== undefined) {
        updatePayload.content = content;
      }

      // Check if there's anything to update
      if (Object.keys(updatePayload).length === 0) {
        return {
          success: false,
          error: "No updates provided. Specify at least one of: name, description, content.",
        };
      }

      const updatedSkill = await updateWorkspaceSkill(existingSkill.id, updatePayload);

      return {
        success: true,
        skillId: updatedSkill.id,
        skillName: updatedSkill.name,
        message: `Updated skill "${updatedSkill.name}". Changes are now live for all users.`,
      };
    },
  });
}

/**
 * Creates skill management tools for a workspace.
 * Returns an empty object if no workspaceId is provided.
 */
export function createSkillTools(workspaceId?: string): ToolSet {
  if (!workspaceId) return {};
  return {
    create_skill: createSkillCreatorTool(workspaceId),
    update_skill: createSkillUpdaterTool(workspaceId),
  };
}
