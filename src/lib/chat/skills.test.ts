import { describe, it, expect } from "vitest";
import type { SkillManifest, ParsedSkill } from "./skills";

/**
 * Tests for skills system logic.
 * Note: Filesystem operations are tested via integration tests.
 * These unit tests focus on the pure logic functions.
 */

describe("SkillManifest", () => {
  // Simulate the logic from loadSkillsForPurpose
  function getSkillNamesForPurpose(
    purpose: "software" | "marketing",
    manifest: SkillManifest
  ): string[] {
    return [
      ...manifest.common,
      ...(purpose === "marketing" ? manifest.marketing : manifest.software),
    ];
  }

  const testManifest: SkillManifest = {
    common: ["attach-content", "shared-skill"],
    software: ["code-review", "testing"],
    marketing: ["aio-geo-optimizer", "content-planning"],
  };

  describe("software purpose", () => {
    it("includes common skills", () => {
      const skills = getSkillNamesForPurpose("software", testManifest);
      expect(skills).toContain("attach-content");
      expect(skills).toContain("shared-skill");
    });

    it("includes software-specific skills", () => {
      const skills = getSkillNamesForPurpose("software", testManifest);
      expect(skills).toContain("code-review");
      expect(skills).toContain("testing");
    });

    it("excludes marketing skills", () => {
      const skills = getSkillNamesForPurpose("software", testManifest);
      expect(skills).not.toContain("aio-geo-optimizer");
      expect(skills).not.toContain("content-planning");
    });

    it("returns correct total count", () => {
      const skills = getSkillNamesForPurpose("software", testManifest);
      expect(skills).toHaveLength(4); // 2 common + 2 software
    });
  });

  describe("marketing purpose", () => {
    it("includes common skills", () => {
      const skills = getSkillNamesForPurpose("marketing", testManifest);
      expect(skills).toContain("attach-content");
      expect(skills).toContain("shared-skill");
    });

    it("includes marketing-specific skills", () => {
      const skills = getSkillNamesForPurpose("marketing", testManifest);
      expect(skills).toContain("aio-geo-optimizer");
      expect(skills).toContain("content-planning");
    });

    it("excludes software skills", () => {
      const skills = getSkillNamesForPurpose("marketing", testManifest);
      expect(skills).not.toContain("code-review");
      expect(skills).not.toContain("testing");
    });

    it("returns correct total count", () => {
      const skills = getSkillNamesForPurpose("marketing", testManifest);
      expect(skills).toHaveLength(4); // 2 common + 2 marketing
    });
  });

  describe("empty manifest sections", () => {
    const emptyManifest: SkillManifest = {
      common: [],
      software: ["only-software"],
      marketing: [],
    };

    it("handles empty common skills", () => {
      const skills = getSkillNamesForPurpose("software", emptyManifest);
      expect(skills).toEqual(["only-software"]);
    });

    it("handles empty purpose-specific skills", () => {
      const skills = getSkillNamesForPurpose("marketing", emptyManifest);
      expect(skills).toEqual([]);
    });
  });
});

describe("ParsedSkill interface", () => {
  it("accepts minimal skill", () => {
    const skill: ParsedSkill = {
      name: "test-skill",
      description: "A test skill",
      content: "Skill instructions here",
    };
    expect(skill.name).toBe("test-skill");
    expect(skill.purposes).toBeUndefined();
    expect(skill.disableModelInvocation).toBeUndefined();
  });

  it("accepts skill with all optional fields", () => {
    const skill: ParsedSkill = {
      name: "full-skill",
      description: "A complete skill",
      content: "Full instructions",
      purposes: ["marketing"],
      disableModelInvocation: true,
      userInvocable: false,
      allowedTools: ["web_search"],
      context: "fork",
    };
    expect(skill.purposes).toEqual(["marketing"]);
    expect(skill.disableModelInvocation).toBe(true);
    expect(skill.userInvocable).toBe(false);
    expect(skill.allowedTools).toEqual(["web_search"]);
    expect(skill.context).toBe("fork");
  });
});

describe("skill content parsing", () => {
  // Simulate frontmatter parsing logic
  function parseSkillFrontmatter(frontmatter: string): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    frontmatter.split("\n").forEach((line) => {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        if (value === "true") data[key] = true;
        else if (value === "false") data[key] = false;
        else if (!isNaN(Number(value))) data[key] = Number(value);
        else data[key] = value;
      }
    });
    return data;
  }

  it("parses name and description", () => {
    const data = parseSkillFrontmatter(`name: my-skill
description: Does something useful`);
    expect(data.name).toBe("my-skill");
    expect(data.description).toBe("Does something useful");
  });

  it("parses boolean flags", () => {
    const data = parseSkillFrontmatter(`disable-model-invocation: true
user-invocable: false`);
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data["user-invocable"]).toBe(false);
  });

  it("handles descriptions with colons", () => {
    const data = parseSkillFrontmatter(
      `description: Use this skill when: the user asks for help`
    );
    expect(data.description).toBe("Use this skill when: the user asks for help");
  });
});
