import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TeamMemberRecord } from "./operations-context";

const APRIL_6_2026 = new Date("2026-04-06T12:00:00Z");

const mockGetTeamRosterForContext = vi.fn();
const mockGetClientMapForContext = vi.fn();

vi.mock("./operations-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./operations-context")>();
  return {
    ...actual,
    getTeamRosterForContext: (...args: unknown[]) => mockGetTeamRosterForContext(...args),
    getClientMapForContext: (...args: unknown[]) => mockGetClientMapForContext(...args),
  };
});

const defaultTeamRoster = [
  { name: "Kathy Horn", firstName: "Kathy", fullName: "Kathy Horn", title: "Co-Founder / Executive Creative Director", roleCategory: "leadership", accountsLed: ["convergix"], nicknames: [], isActive: 1 },
  { name: "Jason Burks", firstName: "Jason", fullName: "Jason Burks", title: "Co-Founder / Development Director", roleCategory: "leadership", accountsLed: ["tap"], nicknames: [], isActive: 1 },
  { name: "Jill Runyon", firstName: "Jill", fullName: "Jill Runyon", title: "Director of Client Experience", roleCategory: "am", accountsLed: ["beyond-petro", "bonterra", "ag1", "edf", "abm"], nicknames: [], isActive: 1 },
  { name: "Allison Shannon", firstName: "Allison", fullName: "Allison Shannon", title: "Strategy Director / Sr. Account Manager", roleCategory: "am", accountsLed: ["wilsonart", "dave-asprey"], nicknames: ["Allie"], isActive: 1 },
  { name: "Lane Jordan", firstName: "Lane", fullName: "Lane Jordan", title: "Creative Director", roleCategory: "creative", accountsLed: [], nicknames: [], isActive: 1 },
  { name: "Leslie Crosby", firstName: "Leslie", fullName: "Leslie Crosby", title: "Sr. Frontend Dev / Technical PM", roleCategory: "dev", accountsLed: [], nicknames: [], isActive: 1 },
  { name: "Ronan Lane", firstName: "Ronan", fullName: "Ronan Lane", title: "Senior PM", roleCategory: "pm", accountsLed: ["hopdoddy", "lppc", "soundly"], nicknames: [], isActive: 1 },
  { name: "Sami Blumenthal", firstName: "Sami", fullName: "Sami Blumenthal", title: "Community Manager", roleCategory: "community", accountsLed: [], nicknames: [], isActive: 1 },
  { name: "Tim Warren", firstName: "Tim", fullName: "Tim Warren", title: "Director of AI", roleCategory: "dev", accountsLed: [], nicknames: [], isActive: 1 },
  { name: "Chris", firstName: "Chris", fullName: "Chris", title: "Copywriter (HDL)", roleCategory: "contractor", accountsLed: [], nicknames: [], isActive: 1 },
  { name: "Josefina", firstName: "Josefina", fullName: "Josefina", title: "Contractor (Soundly)", roleCategory: "contractor", accountsLed: [], nicknames: [], isActive: 1 },
];

const defaultClientMap = [
  { slug: "convergix", name: "Convergix", nicknames: ["CGX", "Convergix"], contacts: [{ name: "Daniel", role: "Marketing Director" }, { name: "Nicole", role: "Marketing" }, { name: "JJ", role: "Stakeholder" }, { name: "Bob", role: "Stakeholder" }, { name: "Jared", role: "Stakeholder" }, { name: "Jamie Nelson", role: "Industry Vertical" }] },
  { slug: "beyond-petro", name: "Beyond Petrochemicals", nicknames: ["BP", "Beyond Petro", "Beyond Petrochemicals"], contacts: [{ name: "Abby Compton" }] },
  { slug: "lppc", name: "LPPC", nicknames: ["LPPC"], contacts: [] },
  { slug: "soundly", name: "Soundly", nicknames: ["Soundly"], contacts: [{ name: "Josefina" }] },
  { slug: "hopdoddy", name: "Hopdoddy", nicknames: ["Hop", "Hopdoddy"], contacts: [] },
  { slug: "bonterra", name: "Bonterra", nicknames: ["Bonterra"], contacts: [{ name: "Paige", role: "Design Liaison" }] },
  { slug: "hdl", name: "High Desert Law", nicknames: ["HDL", "High Desert", "High Desert Law"], contacts: [{ name: "Chris", role: "Copywriter" }, { name: "Jamie Lincoln", role: "Ad Words" }] },
  { slug: "tap", name: "TAP", nicknames: ["TAP"], contacts: [{ name: "Kim Sproul", role: "Client Lead" }] },
  { slug: "dave-asprey", name: "Dave Asprey", nicknames: ["Dave", "Dave Asprey"], contacts: [] },
  { slug: "ag1", name: "AG1", nicknames: ["AG1"], contacts: [] },
  { slug: "edf", name: "EDF", nicknames: ["EDF"], contacts: [] },
  { slug: "wilsonart", name: "Wilsonart", nicknames: ["Wilsonart"], contacts: [] },
  { slug: "abm", name: "ABM", nicknames: ["ABM"], contacts: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTeamRosterForContext.mockResolvedValue(defaultTeamRoster);
  mockGetClientMapForContext.mockResolvedValue(defaultClientMap);
});

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
  async function getPrompt(member: TeamMemberRecord | null = createMember(), date: Date = APRIL_6_2026) {
    const { buildBotSystemPrompt } = await import("./bot-context");
    return buildBotSystemPrompt(member, date);
  }

  describe("date context", () => {
    it("includes today's formatted date", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Monday, April 6, 2026 (2026-04-06)");
    });

    it("includes this week's Monday", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("This week's Monday is 2026-04-06");
    });

    it("includes yesterday and tomorrow", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Yesterday was Sunday, April 5");
      expect(prompt).toContain("Tomorrow is Tuesday, April 7");
    });

    it("tells the bot not to ask for dates", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Never ask the user for dates");
    });

    it("computes Monday correctly for a Wednesday", async () => {
      const wed = new Date("2026-04-08T12:00:00Z");
      const prompt = await getPrompt(createMember(), wed);
      expect(prompt).toContain("This week's Monday is 2026-04-06");
    });

    it("computes Monday correctly for a Sunday", async () => {
      const sun = new Date("2026-04-12T12:00:00Z");
      const prompt = await getPrompt(createMember(), sun);
      expect(prompt).toContain("This week's Monday is 2026-04-06");
    });
  });

  describe("identity context", () => {
    it("includes team member name and title", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Kathy Horn");
      expect(prompt).toContain("Creative Director / Copywriter");
    });

    it("includes role category", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Role: leadership");
    });

    it("includes accounts led", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Leads these accounts: convergix");
    });

    it("includes first-person reference", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain('they mean Kathy');
    });

    it("handles unknown team member gracefully", async () => {
      const prompt = await getPrompt(null);
      expect(prompt).toContain("Unknown team member");
    });

    it("handles member with no accounts led", async () => {
      const prompt = await getPrompt(
        createMember({ accountsLed: [], firstName: "Lane" }),
      );
      expect(prompt).toContain("none specifically");
    });

    it("handles member with multiple accounts led", async () => {
      const prompt = await getPrompt(
        createMember({ accountsLed: ["beyond-petro", "bonterra", "ag1"] }),
      );
      expect(prompt).toContain("beyond-petro, bonterra, ag1");
    });
  });

  describe("team roster", () => {
    it("includes all team members", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Kathy (Kathy Horn)");
      expect(prompt).toContain("Jason (Jason Burks)");
      expect(prompt).toContain("Jill (Jill Runyon)");
      expect(prompt).toContain("Allison (Allison Shannon)");
      expect(prompt).toContain("Lane (Lane Jordan)");
      expect(prompt).toContain("Leslie (Leslie Crosby)");
      expect(prompt).toContain("Ronan (Ronan Lane)");
      expect(prompt).toContain("Sami (Sami Blumenthal)");
    });

    it("includes Lane disambiguation note", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Lane Jordan (Creative Director). Ronan Lane is the PM");
    });
  });

  describe("client map", () => {
    it("includes client nicknames", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("CGX or Convergix = Convergix");
      expect(prompt).toContain("BP or Beyond Petro");
    });

    it("includes client contacts", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Daniel (Marketing Director)");
      expect(prompt).toContain("Nicole (Marketing)");
      expect(prompt).toContain("Kim Sproul (Client Lead)");
    });

    it("includes client contact vs team member distinction", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Client contacts are NOT Civilization team members");
    });
  });

  describe("glossary", () => {
    it("includes status update terms", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("out the door");
      expect(prompt).toContain("buttoned up");
      expect(prompt).toContain("stuck");
    });

    it("includes query terms", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("on tap");
      expect(prompt).toContain("what's the rundown");
    });

    it("includes uncertainty handling", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Unconfirmed:");
    });
  });

  describe("role-based behavior", () => {
    it("includes AM behavior", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("AM asking");
    });

    it("includes leadership behavior", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Leadership asking");
    });

    it("includes status call prep", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Prep me for the status call");
    });
  });

  describe("proactive behavior", () => {
    it("includes contradiction flagging", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("flag the contradiction");
    });

    it("includes multi-update parsing", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Confirm each one separately");
    });
  });

  describe("tone and capability boundaries", () => {
    it("includes emotional awareness", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("acknowledge empathetically");
    });

    it("includes capability boundaries with add_update distinction", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("add_update logs a text note");
      expect(prompt).toContain("NEVER tell the user a field was changed unless");
    });

    it("contains CAN and CANNOT sections", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("What you CAN do");
      expect(prompt).toContain("What you CANNOT do");
      expect(prompt).toContain("update_project_field");
      expect(prompt).toContain("create_project");
      expect(prompt).toContain("create_week_item");
      expect(prompt).toContain("update_week_item");
    });

    it("includes no em dashes rule", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Never use em dashes");
    });
  });

  describe("confirmation rules", () => {
    it("includes confirmation requirements", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Confirmation rules");
      expect(prompt).toContain("Sound right?");
      expect(prompt).toContain("Marking a project completed");
    });

    it("includes multi-update guidance", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Multi-update messages");
      expect(prompt).toContain("Process each update separately");
    });

    it("includes ambiguity rules", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("Ambiguity");
      expect(prompt).toContain("could mean two things");
    });
  });

  describe("core rules", () => {
    it("includes status values", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("in-production, awaiting-client, not-started, blocked, on-hold, completed");
    });

    it("includes update workflow", async () => {
      const prompt = await getPrompt();
      expect(prompt).toContain("get_clients");
      expect(prompt).toContain("update_project_status");
    });
  });
});
