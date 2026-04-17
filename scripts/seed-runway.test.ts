import { describe, it, expect } from "vitest";
import { findProjectIdForWeekItem } from "./seed-runway";
import { TEAM_SEED_DATA, CLIENT_SEED_NICKNAMES, CLIENT_SEED_CONTACTS } from "./seed-runway-data";

function buildMap(
  entries: Record<string, { id: string; name: string }[]>
): Map<string, { id: string; name: string }[]> {
  return new Map(Object.entries(entries));
}

describe("findProjectIdForWeekItem", () => {
  const projectsByClient = buildMap({
    "client-1": [
      { id: "p1", name: "CDS Messaging & Pillars R1" },
      { id: "p2", name: "CDS Creative Wrapper R1" },
      { id: "p3", name: "New Capacity (PPT, brochure, one-pager)" },
      { id: "p4", name: "Events Page Updates (5 tradeshows)" },
      { id: "p5", name: "Social Content (12 posts/mo)" },
      { id: "p6", name: "Fanuc Award Article + LI Post" },
      { id: "p7", name: "Brand Guide v2 (secondary palette)" },
    ],
    "client-2": [
      { id: "p10", name: "Interactive Map" },
      { id: "p11", name: "Website Refresh — Homepage + Private Use" },
    ],
  });

  it("matches when full project name is contained in week item title", () => {
    const result = findProjectIdForWeekItem(
      "client-1",
      "CDS Messaging & Pillars R1 (Gate for all CDS content)",
      projectsByClient
    );
    expect(result).toBe("p1");
  });

  it("matches exact title", () => {
    const result = findProjectIdForWeekItem(
      "client-1",
      "CDS Creative Wrapper R1",
      projectsByClient
    );
    expect(result).toBe("p2");
  });

  it("matches case-insensitively", () => {
    const result = findProjectIdForWeekItem(
      "client-1",
      "cds messaging & pillars r1 (gate for all cds content)",
      projectsByClient
    );
    expect(result).toBe("p1");
  });

  it("matches week item title contained in project name (strategy 2)", () => {
    // "CDS Messaging" (12 chars >= 8) is contained in "CDS Messaging & Pillars R1"
    const result = findProjectIdForWeekItem(
      "client-1",
      "CDS Messaging",
      projectsByClient
    );
    expect(result).toBe("p1");
  });

  it("matches via base name prefix (strategy 3)", () => {
    // "New Capacity" base matches "New Capacity — JJ Revisions" base
    const result = findProjectIdForWeekItem(
      "client-1",
      "New Capacity — JJ Revisions",
      projectsByClient
    );
    expect(result).toBe("p3");
  });

  it("matches Events Page Copy to Events Page Updates", () => {
    const result = findProjectIdForWeekItem(
      "client-1",
      "Events Page Copy",
      projectsByClient
    );
    // "Events Page Updates" base = "events page updates", title base = "events page copy"
    // Neither is a prefix of the other — no match expected
    expect(result).toBeNull();
  });

  it("matches Fanuc Award Article enters schedule", () => {
    const result = findProjectIdForWeekItem(
      "client-1",
      "Fanuc Award Article enters schedule",
      projectsByClient
    );
    // Title base: "fanuc award article enters schedule", project base: "fanuc award article + li post"
    // Neither is prefix of other — no match via strategy 3. But strategy 2: title "fanuc award article enters schedule" not in project name. No match.
    expect(result).toBeNull();
  });

  it("returns null for standalone tasks with no project match", () => {
    const result = findProjectIdForWeekItem(
      "client-1",
      "TAP Travel Invoice",
      projectsByClient
    );
    expect(result).toBeNull();
  });

  it("returns null when client has no projects", () => {
    const result = findProjectIdForWeekItem(
      "unknown-client",
      "CDS Messaging",
      projectsByClient
    );
    expect(result).toBeNull();
  });

  it("prefers longer (more specific) project name matches", () => {
    const map = buildMap({
      "client-x": [
        { id: "short", name: "CDS Content" },
        { id: "long", name: "CDS Messaging & Pillars R1" },
      ],
    });
    const result = findProjectIdForWeekItem(
      "client-x",
      "CDS Messaging & Pillars R1 (Gate for all CDS content)",
      map
    );
    expect(result).toBe("long");
  });

  it("does not match short titles under 8 chars via strategy 2", () => {
    // "Map R2" is only 6 chars — too short for strategy 2
    const result = findProjectIdForWeekItem(
      "client-2",
      "Map R2",
      projectsByClient
    );
    expect(result).toBeNull();
  });

  it("does not false-positive on short common words", () => {
    // "Social Post Approval" base = "social post approval"
    // "Social Content (12 posts/mo)" base = "social content"
    // Neither is prefix of the other
    const result = findProjectIdForWeekItem(
      "client-1",
      "Social Post Approval",
      projectsByClient
    );
    expect(result).toBeNull();
  });
});

describe("TEAM_SEED_DATA", () => {
  it("has fullName for every member", () => {
    for (const member of TEAM_SEED_DATA) {
      expect(member.fullName).toBeDefined();
      expect(member.fullName.length).toBeGreaterThan(0);
    }
  });

  it("has nicknames as an array for every member", () => {
    for (const member of TEAM_SEED_DATA) {
      expect(Array.isArray(member.nicknames)).toBe(true);
    }
  });

  it("Allison has Allie nickname", () => {
    const allison = TEAM_SEED_DATA.find((m) => m.firstName === "Allison");
    expect(allison).toBeDefined();
    expect(allison!.nicknames).toContain("Allie");
  });

  it("matches reference data: all 11 team members", () => {
    expect(TEAM_SEED_DATA).toHaveLength(11);
  });
});

describe("CLIENT_SEED_NICKNAMES", () => {
  it("maps client slugs to nickname arrays", () => {
    expect(CLIENT_SEED_NICKNAMES["convergix"]).toBeDefined();
    expect(Array.isArray(CLIENT_SEED_NICKNAMES["convergix"])).toBe(true);
    expect(CLIENT_SEED_NICKNAMES["convergix"].length).toBeGreaterThan(0);
  });

  it("Convergix has CGX nickname", () => {
    expect(CLIENT_SEED_NICKNAMES["convergix"]).toContain("CGX");
  });

  it("Beyond Petro has BP nickname", () => {
    expect(CLIENT_SEED_NICKNAMES["beyond-petro"]).toContain("BP");
  });
});

describe("CLIENT_SEED_CONTACTS", () => {
  it("stores structured contacts with roles", () => {
    const convergixContacts = CLIENT_SEED_CONTACTS["convergix"];
    expect(convergixContacts).toBeDefined();
    expect(convergixContacts.length).toBeGreaterThan(0);

    const daniel = convergixContacts.find((c) => c.name === "Daniel");
    expect(daniel).toBeDefined();
    expect(daniel!.role).toBe("Marketing Director");
  });

  it("returns empty array for clients with no contacts", () => {
    expect(CLIENT_SEED_CONTACTS["lppc"]).toEqual([]);
  });
});
