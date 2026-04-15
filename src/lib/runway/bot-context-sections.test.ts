import { describe, it, expect } from "vitest";
import type { TeamMemberRecord, TeamRosterEntry, ClientMapEntry } from "./operations-context";
import {
  formatDate,
  addDays,
  buildDateContext,
  buildIdentityContext,
  buildTeamRoster,
  buildClientMap,
  buildQueryRecipes,
} from "./bot-context-sections";

const sampleTeamRoster: TeamRosterEntry[] = [
  { name: "Kathy Horn", firstName: "Kathy", fullName: "Kathy Horn", title: "Co-Founder / Executive Creative Director", roleCategory: "leadership", accountsLed: ["convergix"], nicknames: [], isActive: 1 },
  { name: "Jason Burks", firstName: "Jason", fullName: "Jason Burks", title: "Co-Founder / Development Director", roleCategory: "leadership", accountsLed: ["tap"], nicknames: [], isActive: 1 },
  { name: "Allison Shannon", firstName: "Allison", fullName: "Allison Shannon", title: "Strategy Director / Sr. Account Manager", roleCategory: "am", accountsLed: ["wilsonart", "dave-asprey"], nicknames: ["Allie"], isActive: 1 },
  { name: "Lane Jordan", firstName: "Lane", fullName: "Lane Jordan", title: "Creative Director", roleCategory: "creative", accountsLed: [], nicknames: [], isActive: 1 },
  { name: "Leslie Crosby", firstName: "Leslie", fullName: "Leslie Crosby", title: "Sr. Frontend Dev / Technical PM", roleCategory: "dev", accountsLed: [], nicknames: [], isActive: 1 },
  { name: "Ronan Lane", firstName: "Ronan", fullName: "Ronan Lane", title: "Senior PM", roleCategory: "pm", accountsLed: ["hopdoddy", "lppc", "soundly"], nicknames: [], isActive: 1 },
  { name: "Jill Runyon", firstName: "Jill", fullName: "Jill Runyon", title: "Director of Client Experience", roleCategory: "am", accountsLed: ["beyond-petro"], nicknames: [], isActive: 1 },
  { name: "Sami Blumenthal", firstName: "Sami", fullName: "Sami Blumenthal", title: "Community Manager", roleCategory: "community", accountsLed: [], nicknames: [], isActive: 1 },
];

const sampleClientMap: ClientMapEntry[] = [
  { slug: "convergix", name: "Convergix", nicknames: ["CGX", "Convergix"], contacts: [{ name: "Daniel", role: "Marketing Director" }, { name: "Nicole", role: "Marketing" }] },
  { slug: "beyond-petro", name: "Beyond Petrochemicals", nicknames: ["BP", "Beyond Petro"], contacts: [{ name: "Abby Compton" }] },
  { slug: "lppc", name: "LPPC", nicknames: ["LPPC"], contacts: [] },
  { slug: "hopdoddy", name: "Hopdoddy", nicknames: ["Hop", "Hopdoddy"], contacts: [] },
  { slug: "hdl", name: "High Desert Law", nicknames: ["HDL", "High Desert"], contacts: [{ name: "Chris", role: "Copywriter" }] },
  { slug: "tap", name: "TAP", nicknames: ["TAP"], contacts: [{ name: "Kim Sproul", role: "Client Lead" }] },
];

describe("formatDate", () => {
  it("formats a date with day name, month, date, year, and ISO", () => {
    const date = new Date("2026-04-07T12:00:00");
    const result = formatDate(date);
    expect(result).toContain("Tuesday");
    expect(result).toContain("April");
    expect(result).toContain("7");
    expect(result).toContain("2026");
    expect(result).toContain("2026-04-07");
  });
});

describe("addDays", () => {
  it("adds positive days", () => {
    const base = new Date("2026-04-07T12:00:00");
    const result = addDays(base, 3);
    expect(result.getDate()).toBe(10);
  });

  it("subtracts days with negative value", () => {
    const base = new Date("2026-04-07T12:00:00");
    const result = addDays(base, -2);
    expect(result.getDate()).toBe(5);
  });

  it("does not mutate the original date", () => {
    const base = new Date("2026-04-07T12:00:00");
    addDays(base, 5);
    expect(base.getDate()).toBe(7);
  });
});

describe("buildDateContext", () => {
  it("contains today's formatted date", () => {
    const now = new Date("2026-04-07T12:00:00");
    const result = buildDateContext(now);
    expect(result).toContain("Tuesday");
    expect(result).toContain("April 7");
    expect(result).toContain("2026");
  });

  it("contains this week's Monday", () => {
    const now = new Date("2026-04-07T12:00:00");
    const result = buildDateContext(now);
    // April 6, 2026 is a Monday
    expect(result).toContain("2026-04-06");
  });

  it("contains yesterday and tomorrow", () => {
    const now = new Date("2026-04-07T12:00:00");
    const result = buildDateContext(now);
    expect(result).toContain("Monday"); // yesterday (Apr 6)
    expect(result).toContain("Wednesday"); // tomorrow (Apr 8)
  });

  it("tells the bot not to ask for dates", () => {
    const now = new Date("2026-04-07T12:00:00");
    const result = buildDateContext(now);
    expect(result).toContain("Never ask the user for dates");
  });
});

describe("buildIdentityContext", () => {
  it("returns unknown message for null member", () => {
    const result = buildIdentityContext(null);
    expect(result).toContain("Unknown team member");
  });

  it("includes member name and role for real member", () => {
    const member: TeamMemberRecord = {
      name: "Kathy Horn",
      firstName: "Kathy",
      title: "Co-Founder / Executive Creative Director",
      roleCategory: "leadership",
      accountsLed: ["convergix"],
    };
    const result = buildIdentityContext(member);
    expect(result).toContain("Kathy Horn");
    expect(result).toContain("leadership");
    expect(result).toContain("convergix");
    expect(result).toContain("Co-Founder");
  });

  it("shows 'none specifically' when accountsLed is empty", () => {
    const member: TeamMemberRecord = {
      name: "Lane Jordan",
      firstName: "Lane",
      title: "Creative Director",
      roleCategory: "creative",
      accountsLed: [],
    };
    const result = buildIdentityContext(member);
    expect(result).toContain("none specifically");
  });

  it("uses name as pronoun reference", () => {
    const member: TeamMemberRecord = {
      name: "Jason Burks",
      firstName: "Jason",
      title: null,
      roleCategory: null,
      accountsLed: [],
    };
    const result = buildIdentityContext(member);
    expect(result).toContain('they mean Jason');
  });
});

describe("buildTeamRoster", () => {
  it("contains key team member names", () => {
    const result = buildTeamRoster(sampleTeamRoster);
    expect(result).toContain("Kathy");
    expect(result).toContain("Jason");
    expect(result).toContain("Jill");
    expect(result).toContain("Allison");
    expect(result).toContain("Lane");
    expect(result).toContain("Leslie");
    expect(result).toContain("Ronan");
  });

  it("contains name disambiguation section", () => {
    const result = buildTeamRoster(sampleTeamRoster);
    expect(result).toContain("Lane Jordan");
    expect(result).toContain("Ronan Lane");
    expect(result).toContain("Allie");
  });

  it("includes role categories", () => {
    const result = buildTeamRoster(sampleTeamRoster);
    expect(result).toContain("leadership");
    expect(result).toContain("creative");
    expect(result).toContain("dev");
    expect(result).toContain("am");
  });

  it("handles null title and roleCategory without literal 'null'", () => {
    const roster = [
      { name: "New Person", firstName: null, fullName: null, title: null, roleCategory: null, accountsLed: [], nicknames: [], isActive: 1 },
    ];
    const result = buildTeamRoster(roster);
    expect(result).not.toContain("null");
    expect(result).toContain("unknown title");
    expect(result).toContain("unknown");
    expect(result).toContain("New Person");
  });
});

describe("buildClientMap", () => {
  it("contains client slugs", () => {
    const result = buildClientMap(sampleClientMap);
    expect(result).toContain("convergix");
    expect(result).toContain("beyond-petro");
    expect(result).toContain("lppc");
    expect(result).toContain("hopdoddy");
  });

  it("contains client nicknames", () => {
    const result = buildClientMap(sampleClientMap);
    expect(result).toContain("CGX");
    expect(result).toContain("BP");
    expect(result).toContain("HDL");
  });

  it("contains client contacts section note", () => {
    const result = buildClientMap(sampleClientMap);
    expect(result).toContain("Client contacts vs team members");
    expect(result).toContain("NOT Civilization team members");
  });
});

describe("buildQueryRecipes", () => {
  it("contains key query patterns", () => {
    const result = buildQueryRecipes();
    expect(result).toContain("what's on my plate");
    expect(result).toContain("get_week_items");
    expect(result).toContain("get_person_workload");
    expect(result).toContain("get_projects");
    expect(result).toContain("get_pipeline");
  });

  it("mentions owner vs resource distinction", () => {
    const result = buildQueryRecipes();
    expect(result).toContain("resource");
    expect(result).toContain("owner");
  });

  it("contains status cascade behavior section", () => {
    const result = buildQueryRecipes();
    expect(result).toContain("Status cascade behavior");
    expect(result).toContain("completed, blocked, on-hold");
    expect(result).toContain("linked week items");
  });
});
