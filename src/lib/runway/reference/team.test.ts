import { describe, it, expect } from "vitest";
import {
  TEAM_REFERENCES,
  findTeamMemberByFirstName,
  findTeamMemberByFullName,
  findTeamMember,
  getTeamByRole,
} from "./team";

describe("TEAM_REFERENCES", () => {
  it("contains 11 team members", () => {
    expect(TEAM_REFERENCES).toHaveLength(11);
  });

  it("has unique full names", () => {
    const names = TEAM_REFERENCES.map((m) => m.fullName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has unique first names", () => {
    const firstNames = TEAM_REFERENCES.map((m) => m.firstName);
    expect(new Set(firstNames).size).toBe(firstNames.length);
  });

  it("every member has firstName, fullName, and title", () => {
    for (const member of TEAM_REFERENCES) {
      expect(member.firstName).toBeTruthy();
      expect(member.fullName).toBeTruthy();
      expect(member.title).toBeTruthy();
    }
  });

  it("every member has a valid roleCategory", () => {
    const validRoles = new Set(["creative", "dev", "am", "pm", "leadership", "community", "contractor"]);
    for (const member of TEAM_REFERENCES) {
      expect(validRoles.has(member.roleCategory)).toBe(true);
    }
  });

  it("accountsLed contains only valid client slugs", () => {
    // Known slugs from CLIENT_REFERENCES
    const validSlugs = new Set([
      "convergix", "beyond-petro", "lppc", "soundly", "hopdoddy",
      "bonterra", "hdl", "tap", "dave-asprey", "ag1", "edf", "wilsonart", "abm",
    ]);
    for (const member of TEAM_REFERENCES) {
      for (const slug of member.accountsLed) {
        expect(validSlugs.has(slug)).toBe(true);
      }
    }
  });

  it("fullName starts with firstName", () => {
    for (const member of TEAM_REFERENCES) {
      expect(member.fullName.startsWith(member.firstName)).toBe(true);
    }
  });
});

describe("findTeamMemberByFirstName", () => {
  it("finds Kathy by first name", () => {
    const member = findTeamMemberByFirstName("Kathy");
    expect(member).toBeDefined();
    expect(member!.fullName).toBe("Kathy Horn");
  });

  it("is case-insensitive", () => {
    const member = findTeamMemberByFirstName("kathy");
    expect(member).toBeDefined();
    expect(member!.fullName).toBe("Kathy Horn");
  });

  it("returns undefined for unknown first name", () => {
    expect(findTeamMemberByFirstName("Bob")).toBeUndefined();
  });
});

describe("findTeamMemberByFullName", () => {
  it("finds Ronan Lane by full name", () => {
    const member = findTeamMemberByFullName("Ronan Lane");
    expect(member).toBeDefined();
    expect(member!.roleCategory).toBe("pm");
  });

  it("is case-insensitive", () => {
    const member = findTeamMemberByFullName("ronan lane");
    expect(member).toBeDefined();
  });
});

describe("findTeamMember", () => {
  it("finds by first name", () => {
    const member = findTeamMember("Lane");
    expect(member).toBeDefined();
    expect(member!.fullName).toBe("Lane Jordan");
  });

  it("finds by full name", () => {
    const member = findTeamMember("Lane Jordan");
    expect(member).toBeDefined();
    expect(member!.roleCategory).toBe("creative");
  });

  it("finds by nickname", () => {
    const member = findTeamMember("Allie");
    expect(member).toBeDefined();
    expect(member!.fullName).toBe("Allison Shannon");
  });

  it("Lane defaults to Lane Jordan (not Ronan Lane)", () => {
    const member = findTeamMember("Lane");
    expect(member!.fullName).toBe("Lane Jordan");
  });

  it("Ronan resolves to Ronan Lane via first name", () => {
    const member = findTeamMember("Ronan");
    expect(member!.fullName).toBe("Ronan Lane");
  });

  it("returns undefined for unknown name", () => {
    expect(findTeamMember("Bob")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(findTeamMember("")).toBeUndefined();
  });

  it("is case-insensitive for nicknames", () => {
    const member = findTeamMember("allie");
    expect(member).toBeDefined();
    expect(member!.fullName).toBe("Allison Shannon");
  });

  it("finds Sami by first name", () => {
    const member = findTeamMember("Sami");
    expect(member).toBeDefined();
    expect(member!.roleCategory).toBe("community");
  });
});

describe("getTeamByRole", () => {
  it("returns leadership members", () => {
    const leaders = getTeamByRole("leadership");
    expect(leaders).toHaveLength(2);
    expect(leaders.map((m) => m.firstName).sort()).toEqual(["Jason", "Kathy"]);
  });

  it("returns AM members", () => {
    const ams = getTeamByRole("am");
    expect(ams).toHaveLength(2);
  });

  it("returns PM members", () => {
    const pms = getTeamByRole("pm");
    expect(pms).toHaveLength(1);
    expect(pms[0].firstName).toBe("Ronan");
  });

  it("returns community members", () => {
    const community = getTeamByRole("community");
    expect(community).toHaveLength(1);
    expect(community[0].firstName).toBe("Sami");
  });
});
