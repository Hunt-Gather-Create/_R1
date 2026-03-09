import { describe, it, expect } from "vitest";
import { buildSystemPrompt, type PreviousTaskResult } from "./ai-task-execution";

const parentIssue = {
  identifier: "TASK-1",
  title: "Build landing page",
  description: "Create a responsive landing page for the product launch.",
};

describe("buildSystemPrompt", () => {
  describe("basic prompt structure", () => {
    it("includes parent issue context in dynamic part", () => {
      const { dynamicPart } = buildSystemPrompt(
        parentIssue,
        "Research competitors",
        null,
        null
      );

      expect(dynamicPart).toContain("TASK-1: Build landing page");
      expect(dynamicPart).toContain("responsive landing page");
    });

    it("includes subtask title in dynamic part", () => {
      const { dynamicPart } = buildSystemPrompt(
        parentIssue,
        "Research competitors",
        null,
        null
      );

      expect(dynamicPart).toContain("Research competitors");
    });

    it("includes subtask description when provided", () => {
      const { dynamicPart } = buildSystemPrompt(
        parentIssue,
        "Research competitors",
        "Look at top 5 competitors in the space",
        null
      );

      expect(dynamicPart).toContain("Look at top 5 competitors");
    });

    it("includes special instructions when provided", () => {
      const { dynamicPart } = buildSystemPrompt(
        parentIssue,
        "Research competitors",
        null,
        "Focus on pricing pages"
      );

      expect(dynamicPart).toContain("Focus on pricing pages");
    });

    it("includes tool info in static part", () => {
      const { staticPart } = buildSystemPrompt(
        parentIssue,
        "Research competitors",
        null,
        null
      );

      expect(staticPart).toContain("web_search");
      expect(staticPart).toContain("web_fetch");
    });

    it("handles null parent issue", () => {
      const { dynamicPart } = buildSystemPrompt(
        null,
        "Research competitors",
        null,
        null
      );

      expect(dynamicPart).toContain("No parent context available.");
    });
  });

  describe("soul integration", () => {
    it("includes soul personality in static part", () => {
      const soul = {
        name: "Alex",
        personality: "Friendly and helpful",
        tone: "casual",
        responseLength: "concise",
      };

      const { staticPart } = buildSystemPrompt(
        parentIssue,
        "Research competitors",
        null,
        null,
        soul
      );

      expect(staticPart).toContain("You are Alex. Friendly and helpful");
      expect(staticPart).toContain("Tone: casual");
      expect(staticPart).toContain("Response Length: concise");
    });

    it("omits soul section when null", () => {
      const { staticPart } = buildSystemPrompt(
        parentIssue,
        "Research competitors",
        null,
        null,
        null
      );

      // Should not contain soul-style "You are <name>." but should contain the generic instruction
      expect(staticPart).not.toMatch(/You are \w+\./);
      expect(staticPart).toContain("You are completing a subtask");
    });
  });

  describe("previous results context chaining", () => {
    it("omits prior subtasks section when no previous results", () => {
      const { dynamicPart } = buildSystemPrompt(
        parentIssue,
        "Write copy",
        null,
        null,
        null,
        null,
        []
      );

      expect(dynamicPart).not.toContain("Completed Prior Subtasks");
    });

    it("includes previous results in dynamic part", () => {
      const previousResults: PreviousTaskResult[] = [
        {
          identifier: "TASK-2",
          title: "Research competitors",
          summary: "Found 5 competitors: A, B, C, D, E. Key insight: all use pricing tiers.",
        },
      ];

      const { dynamicPart } = buildSystemPrompt(
        parentIssue,
        "Write copy",
        null,
        null,
        null,
        null,
        previousResults
      );

      expect(dynamicPart).toContain("Completed Prior Subtasks");
      expect(dynamicPart).toContain("TASK-2: Research competitors");
      expect(dynamicPart).toContain("Found 5 competitors");
    });

    it("includes multiple previous results in order", () => {
      const previousResults: PreviousTaskResult[] = [
        {
          identifier: "TASK-2",
          title: "Research competitors",
          summary: "Competitor analysis complete.",
        },
        {
          identifier: "TASK-3",
          title: "Define target audience",
          summary: "Primary audience: developers aged 25-40.",
        },
      ];

      const { dynamicPart } = buildSystemPrompt(
        parentIssue,
        "Write copy",
        null,
        null,
        null,
        null,
        previousResults
      );

      const task2Pos = dynamicPart.indexOf("TASK-2");
      const task3Pos = dynamicPart.indexOf("TASK-3");
      expect(task2Pos).toBeLessThan(task3Pos);
      expect(dynamicPart).toContain("Competitor analysis complete.");
      expect(dynamicPart).toContain("Primary audience: developers aged 25-40.");
    });

    it("places previous results before current subtask section", () => {
      const previousResults: PreviousTaskResult[] = [
        {
          identifier: "TASK-2",
          title: "Research",
          summary: "Done.",
        },
      ];

      const { dynamicPart } = buildSystemPrompt(
        parentIssue,
        "Write copy",
        null,
        null,
        null,
        null,
        previousResults
      );

      const priorPos = dynamicPart.indexOf("Completed Prior Subtasks");
      const yourTaskPos = dynamicPart.indexOf("## Your Subtask");
      expect(priorPos).toBeLessThan(yourTaskPos);
    });

    it("keeps previous results out of static part (not cacheable)", () => {
      const previousResults: PreviousTaskResult[] = [
        {
          identifier: "TASK-2",
          title: "Research",
          summary: "Some findings.",
        },
      ];

      const { staticPart } = buildSystemPrompt(
        parentIssue,
        "Write copy",
        null,
        null,
        null,
        null,
        previousResults
      );

      expect(staticPart).not.toContain("Completed Prior Subtasks");
      expect(staticPart).not.toContain("TASK-2");
    });
  });
});
