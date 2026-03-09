import { readFile, readdir } from "fs/promises";
import { join } from "path";
import matter from "gray-matter";
import type { WorkspacePurpose } from "@/lib/design-tokens";
import { getEnabledWorkspaceSkills } from "@/lib/actions/skills";

/**
 * Parsed skill from SKILL.md file
 */
export interface ParsedSkill {
  name: string;
  description: string;
  content: string;
  /** Which workspace purposes this skill applies to. If not specified, applies to all. */
  purposes?: WorkspacePurpose[];
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  context?: string;
}

/**
 * Skill manifest for organizing skills
 */
export interface SkillManifest {
  /** Skills that apply to all workspace types */
  common: string[];
  /** Skills specific to software development */
  software: string[];
  /** Skills specific to marketing */
  marketing: string[];
}

/**
 * Default skill manifest - defines which skills load for which purpose
 */
const DEFAULT_SKILL_MANIFEST: SkillManifest = {
  common: ["attach-content"],
  software: [],
  marketing: [
    "aio-geo-optimizer",
    "marketing/video-content-strategy",
    "marketing/earned-media-strategy",
  ],
};

/**
 * Skill manifest for workspace chat. ad-campaign is marketing-only;
 * workspace and issue chat only expose ad tools for marketing workspaces.
 */
export const WORKSPACE_SKILL_MANIFEST: SkillManifest = {
  ...DEFAULT_SKILL_MANIFEST,
  marketing: [...DEFAULT_SKILL_MANIFEST.marketing, "ad-campaign"],
};

/**
 * Load and parse a single skill from the skills directory
 */
export async function loadSkill(
  skillName: string
): Promise<ParsedSkill | null> {
  try {
    const skillPath = join(process.cwd(), "skills", skillName, "SKILL.md");
    const fileContent = await readFile(skillPath, "utf-8");
    const { data, content } = matter(fileContent);

    return {
      name: data.name || skillName,
      description: data.description || "",
      content: content.trim(),
      purposes: data.purposes,
      disableModelInvocation: data["disable-model-invocation"],
      userInvocable: data["user-invocable"],
      allowedTools: data["allowed-tools"],
      context: data.context,
    };
  } catch {
    return null;
  }
}

/**
 * Load all skills for a given workspace purpose
 */
export async function loadSkillsForPurpose(
  purpose: WorkspacePurpose,
  manifest: SkillManifest = DEFAULT_SKILL_MANIFEST
): Promise<ParsedSkill[]> {
  const skillNames = [
    ...manifest.common,
    ...(purpose === "marketing" ? manifest.marketing : manifest.software),
  ];

  const skills = await Promise.all(skillNames.map(loadSkill));
  return skills.filter((s): s is ParsedSkill => s !== null);
}

/**
 * Discover all available skills in the skills directory
 */
export async function discoverSkills(): Promise<string[]> {
  try {
    const skillsDir = join(process.cwd(), "skills");
    const entries = await readdir(skillsDir, { withFileTypes: true });

    const skillNames: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        // Check if SKILL.md exists in this directory
        try {
          await readFile(join(skillsDir, entry.name, "SKILL.md"), "utf-8");
          skillNames.push(entry.name);
        } catch {
          // No SKILL.md, skip this directory
        }
      }
    }

    return skillNames;
  } catch {
    return [];
  }
}

/**
 * Load all discovered skills
 */
export async function loadAllSkills(): Promise<ParsedSkill[]> {
  const skillNames = await discoverSkills();
  const skills = await Promise.all(skillNames.map(loadSkill));
  return skills.filter((s): s is ParsedSkill => s !== null);
}

/**
 * Load skills for a workspace - merges file-based skills with database skills.
 * Database skills override file-based skills with the same name.
 */
export async function loadSkillsForWorkspace(
  workspaceId: string,
  purpose: WorkspacePurpose,
  manifest: SkillManifest = DEFAULT_SKILL_MANIFEST
): Promise<ParsedSkill[]> {
  // Load file-based skills for purpose
  const fileSkills = await loadSkillsForPurpose(purpose, manifest);

  // Load workspace-specific skills from database
  const dbSkills = await getEnabledWorkspaceSkills(workspaceId);

  // Convert database skills to ParsedSkill format
  const workspaceSkills: ParsedSkill[] = dbSkills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    content: skill.content,
    // Workspace skills inherit the workspace's purpose
    purposes: [purpose],
  }));

  // Merge: DB skills override file-based skills with same name
  const skillMap = new Map<string, ParsedSkill>();

  // Add file-based skills first
  for (const skill of fileSkills) {
    skillMap.set(skill.name, skill);
  }

  // Add/override with workspace skills
  for (const skill of workspaceSkills) {
    skillMap.set(skill.name, skill);
  }

  return Array.from(skillMap.values());
}
