/**
 * Column J resolution through staffing, rules 1 to 6, and the staffing read.
 * Every client and person here is invented.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestDb, createTestDb, seedTestDb } from "../../src/lib/runway/test-db";
import { validateRoleTagOnResources } from "../../src/lib/runway/operations-utils";
import { planPeople } from "./role-map";
import { vocabularyTags } from "./role-vocabulary";
import { parseTeam, staffingFromRows, type Staffing } from "./staffing";
import { loadStaffing } from "./staffing-read";
import { SYNTHETIC_SOURCE } from "./account-teams.test-fixtures";
import { CLIENT_ROWS, MEMBER_ROWS, STAFFING } from "./staffing.test-fixtures";

const planned = (owner: string, resources: string) => ({ kind: "planned", owner, resources });
const refused = (...unmapped: string[]) => ({ kind: "refused", unmapped });

describe("rule 1: the vocabulary maps label words to role tags, never to people", () => {
  it.each([
    ["Design", "CD: Wren"],
    ["Creative", "CD: Wren"],
    ["Creatives", "CD: Wren"],
    ["Dev", "Dev: Quill"],
    ["QA", "QA: Quill"],
    ["PM", "PM: Tobin"],
    ["AM", "AM: Marlo"],
  ])("%s resolves to %s on northwind", (label, resources) => {
    expect(planPeople(label, "northwind", STAFFING)).toMatchObject({ kind: "planned", resources });
  });

  it("drops a leading Civ and splits on plus, comma and slash", () => {
    expect(planPeople("Civ Creative", "northwind", STAFFING)).toEqual(planned("Wren", "CD: Wren"));
    expect(planPeople("PM/Design", "northwind", STAFFING)).toEqual(planned("Tobin", "PM: Tobin, CD: Wren"));
    expect(planPeople("PM, Design", "northwind", STAFFING)).toEqual(planned("Tobin", "PM: Tobin, CD: Wren"));
    expect(planPeople("PM + Design", "northwind", STAFFING)).toEqual(planned("Tobin", "PM: Tobin, CD: Wren"));
  });

  it("every tag the vocabulary emits passes validateRoleTagOnResources", () => {
    for (const tag of vocabularyTags()) expect(validateRoleTagOnResources(`${tag}: Wren`), tag).toEqual({ ok: true });
  });
});

describe("rule 2: a role tag resolves through the client's team, AM through accountsLed first", () => {
  it("the same word names whoever the client's team staffs", () => {
    const other: Staffing = {
      ...STAFFING,
      clients: { ...STAFFING.clients, northwind: { ...STAFFING.clients.northwind, team: [{ roleTag: "CD", name: "Juniper" }] } },
    };
    expect(planPeople("Design", "northwind", other)).toEqual(planned("Juniper", "CD: Juniper"));
  });

  it("AM comes from the active member whose accountsLed holds the client", () => {
    expect(planPeople("Account", "northwind", STAFFING)).toEqual(planned("Marlo", "AM: Marlo"));
  });

  it("AM falls back to the team's AM pair, matched by full name, when no active member leads the client", () => {
    expect(planPeople("Account", "teamam", STAFFING)).toEqual(planned("Tobin", "AM: Tobin"));
  });

  it("two active leads with no team AM pair to choose between them refuse", () => {
    const twoLeads: Staffing = {
      ...STAFFING,
      members: STAFFING.members.map((m) => (m.firstName === "Juniper" ? { ...m, accountsLed: ["northwind"] } : m)),
    };
    expect(planPeople("Account", "northwind", twoLeads)).toEqual(refused("Account"));
  });
});

describe("rule 3: a label that is an active member's first name binds that person", () => {
  it("with the role tag from the client's team when the person is on it", () => {
    expect(planPeople("Wren", "northwind", STAFFING)).toEqual(planned("Wren", "CD: Wren"));
  });

  it("with the role tag from roleCategory when the person is not on the team", () => {
    expect(planPeople("Juniper", "northwind", STAFFING)).toEqual(planned("Juniper", "Strategy: Juniper"));
  });

  it("a roleCategory with no tag refuses", () => {
    expect(planPeople("Ossian", "northwind", STAFFING)).toEqual(refused("Ossian"));
  });
});

describe("rule 4: a label that names the client makes a client row", () => {
  it.each(["Northwind Petro", "NWP", "Northwind", "nwp"])("%s plans Client: Northwind Petro, owner the AM", (label) => {
    expect(planPeople(label, "northwind", STAFFING)).toEqual(planned("Marlo", "Client: Northwind Petro"));
  });

  it("the AM owns a client row even when another label comes first", () => {
    expect(planPeople("Design + NWP", "northwind", STAFFING)).toEqual(planned("Marlo", "CD: Wren, Client: Northwind Petro"));
  });

  it("another client's nickname is not a client label here", () => {
    expect(planPeople("EMP", "northwind", STAFFING)).toEqual(refused("EMP"));
  });
});

describe("rule 5: anything that does not resolve refuses the whole row, naming the label", () => {
  it("a word with no vocabulary entry", () => {
    expect(planPeople("Design, Copywriting", "northwind", STAFFING)).toEqual(refused("Copywriting"));
  });

  it("a role the client's team does not staff", () => {
    expect(planPeople("Strategy + Design", "northwind", STAFFING)).toEqual(refused("Strategy"));
  });

  it("a name that is not a team member", () => {
    expect(planPeople("Design + Hollis", "northwind", STAFFING)).toEqual(refused("Hollis"));
  });

  it("a team pair whose name is not a member refuses its role", () => {
    const stray: Staffing = {
      ...STAFFING,
      clients: { ...STAFFING.clients, northwind: { ...STAFFING.clients.northwind, team: [{ roleTag: "CD", name: "Hollis" }] } },
    };
    expect(planPeople("Design", "northwind", stray)).toEqual(refused("Design"));
  });
});

describe("rule 6: owner is the first resolved person, resources keep label order, one entry per person", () => {
  it("label order sets owner and resources order", () => {
    expect(planPeople("Dev + Design", "northwind", STAFFING)).toEqual(planned("Quill", "Dev: Quill, CD: Wren"));
    expect(planPeople("Design + Dev", "northwind", STAFFING)).toEqual(planned("Wren", "CD: Wren, Dev: Quill"));
  });

  it("a person named twice appears once, under the first role", () => {
    expect(planPeople("Dev + QA", "northwind", STAFFING)).toEqual(planned("Quill", "Dev: Quill"));
    expect(planPeople("Design + Creatives + Wren", "northwind", STAFFING)).toEqual(planned("Wren", "CD: Wren"));
  });
});

describe("a client with an empty team", () => {
  it("refuses every role label", () => {
    for (const label of ["Design", "Dev", "QA", "PM", "Copy", "Motion", "Strategy"]) {
      expect(planPeople(label, "emptyco", STAFFING), label).toEqual(refused(label));
    }
  });

  it("still resolves a client label to the AM from accountsLed", () => {
    expect(planPeople("EMP", "emptyco", STAFFING)).toEqual(planned("Marlo", "Client: Emptyco"));
    expect(planPeople("Account", "emptyco", STAFFING)).toEqual(planned("Marlo", "AM: Marlo"));
  });
});

describe("an inactive member is never planned", () => {
  it("not as an account lead", () => {
    expect(STAFFING.members.find((m) => m.firstName === "Esker")).toMatchObject({ isActive: false, accountsLed: ["northwind", "teamam"] });
    expect(planPeople("Account", "teamam", STAFFING)).toEqual(planned("Tobin", "AM: Tobin"));
  });

  it("not through a team pair", () => {
    expect(planPeople("Motion", "northwind", STAFFING)).toEqual(refused("Motion"));
  });

  it("not by first name", () => {
    expect(planPeople("Esker", "northwind", STAFFING)).toEqual(refused("Esker"));
  });

  it("not as the only account manager of a client row", () => {
    const onlyInactive = staffingFromRows(
      [{ slug: "solo", name: "Solo Co", nicknames: null, team: "AM: Esker" }],
      MEMBER_ROWS
    );
    expect(planPeople("Solo Co", "solo", onlyInactive)).toEqual(refused("Solo Co"));
  });
});

describe("parseTeam", () => {
  it("keeps Role: Name pairs and returns every other part as ignored", () => {
    expect(parseTeam("CD: Wren, Design: Juniper, Wren Calder (lead), Lead: Quill, Dev:")).toEqual({
      pairs: [
        { roleTag: "CD", name: "Wren" },
        { roleTag: "CD", name: "Juniper" },
      ],
      ignored: ["Wren Calder (lead)", "Lead: Quill", "Dev:"],
    });
    expect(parseTeam(null)).toEqual({ pairs: [], ignored: [] });
  });
});

describe("loadStaffing reads client labels from the Runway database and teams from the Account Teams sheet", () => {
  let dbPath = "";
  afterEach(() => {
    if (dbPath) cleanupTestDb(dbPath);
  });

  it("resolves the same client row the rows build", async () => {
    const created = await createTestDb();
    dbPath = created.dbPath;
    await seedTestDb(created.client);
    await created.client.execute("DELETE FROM team_members");
    for (const [i, c] of CLIENT_ROWS.entries()) {
      await created.client.execute({
        sql: "INSERT INTO clients (id, name, slug, nicknames, team, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0)",
        args: [`cl-syn-${i}`, c.name, c.slug, c.nicknames, c.team],
      });
    }
    const loaded = await loadStaffing(created.db, SYNTHETIC_SOURCE);
    for (const slug of ["northwind", "emptyco", "teamam"]) {
      expect({ name: loaded.clients[slug].name, nicknames: loaded.clients[slug].nicknames }).toEqual({
        name: STAFFING.clients[slug].name,
        nicknames: STAFFING.clients[slug].nicknames,
      });
    }
    expect(loaded.members.map((m) => m.fullName)).toEqual(STAFFING.members.map((m) => m.fullName));
    expect(planPeople("Civ + NWP", "northwind", loaded)).toEqual(planned("Marlo", "AM: Marlo, Client: Northwind Petro"));
  });
});
