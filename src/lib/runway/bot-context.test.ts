import { describe, it, expect } from "vitest";
import { buildBotSystemPrompt } from "./bot-context";
import type { TeamMemberRecord } from "./operations-context";

const APRIL_6_2026 = new Date("2026-04-06T12:00:00Z");

function createMember(overrides: Partial<TeamMemberRecord> = {}): TeamMemberRecord {
  return {
    name: "Kathy Horn",
    firstName: "Kathy",
    title: "Creative Director / Copywriter",
    roleCategory: "leadership",
    accountsLed: ["convergix"],
    ...overrides,
  };
}

describe("buildBotSystemPrompt", () => {
  describe("date context", () => {
    it("includes today's formatted date", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Monday, April 6, 2026 (2026-04-06)");
    });

    it("includes this week's Monday", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("This week's Monday is 2026-04-06");
    });

    it("includes yesterday and tomorrow", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Yesterday was Sunday, April 5");
      expect(prompt).toContain("Tomorrow is Tuesday, April 7");
    });

    it("tells the bot not to ask for dates", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Never ask the user for dates");
    });

    it("computes Monday correctly for a Wednesday", () => {
      const wed = new Date("2026-04-08T12:00:00Z");
      const prompt = buildBotSystemPrompt(createMember(), wed);
      expect(prompt).toContain("This week's Monday is 2026-04-06");
    });

    it("computes Monday correctly for a Sunday", () => {
      const sun = new Date("2026-04-12T12:00:00Z");
      const prompt = buildBotSystemPrompt(createMember(), sun);
      // Sunday belongs to the previous week's Monday (4/6)
      expect(prompt).toContain("This week's Monday is 2026-04-06");
    });
  });

  describe("identity context", () => {
    it("includes team member name and title", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Kathy Horn");
      expect(prompt).toContain("Creative Director / Copywriter");
    });

    it("includes role category", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Role: leadership");
    });

    it("includes accounts led", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Leads these accounts: convergix");
    });

    it("includes first-person reference", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain('they mean Kathy');
    });

    it("handles unknown team member gracefully", () => {
      const prompt = buildBotSystemPrompt(null, APRIL_6_2026);
      expect(prompt).toContain("Unknown team member");
    });

    it("handles member with no accounts led", () => {
      const prompt = buildBotSystemPrompt(
        createMember({ accountsLed: [], firstName: "Lane" }),
        APRIL_6_2026
      );
      expect(prompt).toContain("none specifically");
    });

    it("handles member with multiple accounts led", () => {
      const prompt = buildBotSystemPrompt(
        createMember({ accountsLed: ["beyond-petro", "bonterra", "ag1"] }),
        APRIL_6_2026
      );
      expect(prompt).toContain("beyond-petro, bonterra, ag1");
    });
  });

  describe("team roster", () => {
    it("includes all team members", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Kathy (Kathy Horn)");
      expect(prompt).toContain("Jason (Jason Burks)");
      expect(prompt).toContain("Jill (Jill Runyon)");
      expect(prompt).toContain("Allison (Allison Shannon)");
      expect(prompt).toContain("Lane (Lane Jordan)");
      expect(prompt).toContain("Leslie (Leslie Crosby)");
      expect(prompt).toContain("Ronan (Ronan Lane)");
      expect(prompt).toContain("Sami (Sami Blumenthal)");
    });

    it("includes Lane disambiguation note", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Lane Jordan (Creative Director). Ronan Lane is the PM");
    });
  });

  describe("client map", () => {
    it("includes client nicknames", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("CGX or Convergix = Convergix");
      expect(prompt).toContain("BP or Beyond Petro");
    });

    it("includes client contacts", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Daniel (Marketing Director)");
      expect(prompt).toContain("Nicole (Marketing)");
      expect(prompt).toContain("Kim Sproul (Client Lead)");
    });

    it("includes client contact vs team member distinction", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Client contacts are NOT Civilization team members");
    });
  });

  describe("glossary", () => {
    it("includes status update terms", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("out the door");
      expect(prompt).toContain("buttoned up");
      expect(prompt).toContain("stuck");
    });

    it("includes query terms", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("on tap");
      expect(prompt).toContain("what's the rundown");
    });

    it("includes uncertainty handling", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Unconfirmed:");
    });
  });

  describe("role-based behavior", () => {
    it("includes AM behavior", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("AM asking");
    });

    it("includes leadership behavior", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Leadership asking");
    });

    it("includes status call prep", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Prep me for the status call");
    });
  });

  describe("proactive behavior", () => {
    it("includes contradiction flagging", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("flag the contradiction");
    });

    it("includes multi-update parsing", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Confirm each one separately");
    });
  });

  describe("tone and unsupported features", () => {
    it("includes emotional awareness", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("acknowledge empathetically");
    });

    it("includes unsupported feature handling", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Availability tracking isn't in Runway yet");
      expect(prompt).toContain("Reminders aren't set up yet");
    });

    it("includes no em dashes rule", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("Never use em dashes");
    });
  });

  describe("core rules", () => {
    it("includes status values", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("in-production, awaiting-client, not-started, blocked, on-hold, completed");
    });

    it("includes update workflow", () => {
      const prompt = buildBotSystemPrompt(createMember(), APRIL_6_2026);
      expect(prompt).toContain("get_clients");
      expect(prompt).toContain("update_project_status");
    });
  });
});
