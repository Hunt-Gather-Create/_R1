import { describe, it, expect } from "vitest";
import { createSkillSchema, updateSkillSchema } from "./schemas";
import { normalizeSkillName } from "./skill-creator-tool";

describe("createSkillSchema", () => {
  describe("valid inputs", () => {
    it("accepts valid skill with all fields", () => {
      const input = {
        name: "simplify-for-kids",
        description: "Rewrite content to be understandable by a 5-year-old",
        content: "# Simplify Content\n\nUse short sentences and simple words.",
      };

      const result = createSkillSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts skill name with hyphens", () => {
      const input = {
        name: "code-review-helper",
        description: "Help with code reviews",
        content: "Review code for best practices.",
      };

      const result = createSkillSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts skill with longer content", () => {
      const input = {
        name: "detailed-skill",
        description: "A skill with detailed instructions",
        content: `# Detailed Instructions

## Step 1
Do something first.

## Step 2
Do something second.

## Step 3
Finish up.`,
      };

      const result = createSkillSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it("rejects missing name", () => {
      const input = {
        description: "Some description",
        content: "Some content",
      };

      const result = createSkillSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing description", () => {
      const input = {
        name: "test-skill",
        content: "Some content",
      };

      const result = createSkillSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing content", () => {
      const input = {
        name: "test-skill",
        description: "Some description",
      };

      const result = createSkillSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects empty object", () => {
      const result = createSkillSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string values", () => {
      const input = {
        name: 123,
        description: "Some description",
        content: "Some content",
      };

      const result = createSkillSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});

describe("normalizeSkillName", () => {
  it("converts uppercase to lowercase", () => {
    expect(normalizeSkillName("MySkill")).toBe("myskill");
    expect(normalizeSkillName("CODE-REVIEW")).toBe("code-review");
  });

  it("replaces spaces with hyphens", () => {
    expect(normalizeSkillName("my skill")).toBe("my-skill");
    expect(normalizeSkillName("code review helper")).toBe("code-review-helper");
  });

  it("removes invalid characters", () => {
    expect(normalizeSkillName("skill@#$%")).toBe("skill");
    expect(normalizeSkillName("my_skill")).toBe("myskill");
    expect(normalizeSkillName("skill.name")).toBe("skillname");
  });

  it("handles combined transformations", () => {
    expect(normalizeSkillName("My Skill Name!")).toBe("my-skill-name");
    expect(normalizeSkillName("Code Review (v2)")).toBe("code-review-v2");
  });

  it("preserves valid names", () => {
    expect(normalizeSkillName("simplify-for-kids")).toBe("simplify-for-kids");
    expect(normalizeSkillName("code-review-123")).toBe("code-review-123");
  });
});

describe("updateSkillSchema", () => {
  describe("valid inputs", () => {
    it("accepts update with all fields and confirmation", () => {
      const input = {
        skillName: "simplify-for-kids",
        name: "simplify-content",
        description: "Updated description",
        content: "# Updated Content",
        userConfirmed: true,
      };

      const result = updateSkillSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts update with only description change", () => {
      const input = {
        skillName: "simplify-for-kids",
        description: "New description only",
        userConfirmed: true,
      };

      const result = updateSkillSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts update with only content change", () => {
      const input = {
        skillName: "simplify-for-kids",
        content: "# New Content Only",
        userConfirmed: true,
      };

      const result = updateSkillSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("accepts update with userConfirmed false (schema allows it, tool enforces)", () => {
      const input = {
        skillName: "simplify-for-kids",
        content: "# New Content",
        userConfirmed: false,
      };

      const result = updateSkillSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    it("rejects missing skillName", () => {
      const input = {
        description: "New description",
        userConfirmed: true,
      };

      const result = updateSkillSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects missing userConfirmed", () => {
      const input = {
        skillName: "simplify-for-kids",
        description: "New description",
      };

      const result = updateSkillSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("rejects empty object", () => {
      const result = updateSkillSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
