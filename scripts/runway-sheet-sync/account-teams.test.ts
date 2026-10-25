/**
 * Staffing comes from the Civilization Account Teams sheet. Synthetic sheet
 * and scratch database only; every client and person here is invented.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTestDb, createTestDb, seedTestDb } from "../../src/lib/runway/test-db";
import { ACCOUNT_TEAMS_ENV, PEOPLE_HEADER, TEAMS_HEADER, requireAccountTeamsSheetId, staffingFromSheet } from "./account-teams";
import {
  CLIENT_LABEL_ROWS,
  GRIDS,
  PEOPLE_GRID,
  SYNTHETIC_TEAMS_SHEET_ID,
  TEAMS_GRID,
  syntheticRead,
} from "./account-teams.test-fixtures";
import { diffSheet } from "./diff";
import { captureProdSnapshot, loadProdSnapshot, writeProdSnapshot } from "./parity/prod-snapshot";
import { BUNDLE, emptyLedger, leaf, parsedWith } from "./diff.test-fixtures";
import { renderReport } from "./report";
import { planPeople } from "./role-map";
import { loadStaffing } from "./staffing-read";

const planned = (owner: string, resources: string) => ({ kind: "planned", owner, resources });
const refused = (...unmapped: string[]) => ({ kind: "refused", unmapped });
const ENV = { [ACCOUNT_TEAMS_ENV]: SYNTHETIC_TEAMS_SHEET_ID };

describe("loadStaffing reads teams and people from the Account Teams sheet, not the database", () => {
  let dbPath = "";
  afterEach(() => {
    if (dbPath) cleanupTestDb(dbPath);
  });

  it("resolves through the sheet even when clients.team and team_members name someone else", async () => {
    const created = await createTestDb();
    dbPath = created.dbPath;
    await seedTestDb(created.client);
    await created.client.execute("DELETE FROM team_members");
    for (const [i, c] of CLIENT_LABEL_ROWS.entries()) {
      await created.client.execute({
        sql: "INSERT INTO clients (id, name, slug, nicknames, team, created_at, updated_at) VALUES (?, ?, ?, ?, 'CD: Juniper, AM: Juniper', 0, 0)",
        args: [`cl-syn-${i}`, c.name, c.slug, c.nicknames],
      });
    }
    await created.client.execute({
      sql: "INSERT INTO team_members (id, name, first_name, full_name, role_category, accounts_led, is_active) VALUES ('tm-syn', 'Juniper Hale', 'Juniper', 'Juniper Hale', 'creative', ?, 1)",
      args: [JSON.stringify(["northwind"])],
    });
    const calls: string[] = [];

    const loaded = await loadStaffing(created.db, { env: ENV, read: syntheticRead(GRIDS, calls) });

    expect(calls.sort()).toEqual([`${SYNTHETIC_TEAMS_SHEET_ID} 'Account Teams'!A:Z`, `${SYNTHETIC_TEAMS_SHEET_ID} 'People'!A:Z`]);
    expect(planPeople("Design", "northwind", loaded)).toEqual(planned("Wren", "CD: Wren"));
    expect(planPeople("Civ + NWP", "northwind", loaded)).toEqual(planned("Marlo", "AM: Marlo, Client: Northwind Petro"));
    expect(planPeople("Quill", "northwind", loaded)).toEqual(planned("Quill", "Dev: Quill"));
    // Juniper is active in People but on no Northwind row, so no role binds and the label refuses.
    expect(planPeople("Juniper", "northwind", loaded)).toEqual(refused("Juniper"));
    // Client labels still come from the Runway clients table.
    expect(loaded.clients.northwind.nicknames).toEqual(["NWP", "Northwind"]);
  });
});

describe("the AM for a client comes from its AM rows", () => {
  it("one active AM row resolves a client row; two active AMs refuse", () => {
    const one = staffingFromSheet(GRIDS, CLIENT_LABEL_ROWS);
    expect(planPeople("EMP", "emptyco", one)).toEqual(planned("Marlo", "Client: Emptyco"));
    expect(planPeople("Dev", "emptyco", one)).toEqual(refused("Dev"));

    const two = staffingFromSheet(
      { people: PEOPLE_GRID, teams: [...TEAMS_GRID, ["emptyco", "Emptyco", "AM", "Juniper", "", "synthetic"]] },
      CLIENT_LABEL_ROWS
    );
    expect(planPeople("EMP", "emptyco", two)).toEqual(refused("EMP"));
  });
});

describe("a missing RUNWAY_ACCOUNT_TEAMS_SHEET_ID stops the run", () => {
  it("throws one plain line before any database or sheet read", async () => {
    const calls: string[] = [];
    const noDb = new Proxy({}, { get: () => { throw new Error("database read"); } });
    for (const env of [{}, { [ACCOUNT_TEAMS_ENV]: "  " }]) {
      const err = await loadStaffing(noDb as never, { env, read: syntheticRead(GRIDS, calls) }).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(
        "RUNWAY_ACCOUNT_TEAMS_SHEET_ID is not set, so staffing cannot be read from the Civilization Account Teams sheet."
      );
    }
    expect(calls).toEqual([]);
    expect(requireAccountTeamsSheetId(ENV)).toBe(SYNTHETIC_TEAMS_SHEET_ID);
  });
});

describe("a wrong header row refuses, naming the tab", () => {
  it.each([
    ["People", { people: [["First Name", "Last Name", "Role", "Active"], ...PEOPLE_GRID.slice(1)], teams: TEAMS_GRID }, PEOPLE_HEADER],
    ["People", { people: [[...PEOPLE_HEADER, "Extra"], ...PEOPLE_GRID.slice(1)], teams: TEAMS_GRID }, PEOPLE_HEADER],
    ["Account Teams", { people: PEOPLE_GRID, teams: [["Client Slug", "Role", "Person"], ...TEAMS_GRID.slice(1)] }, TEAMS_HEADER],
    ["Account Teams", { people: PEOPLE_GRID, teams: [] }, TEAMS_HEADER],
  ])("tab %s", (tab, grids, header) => {
    expect(() => staffingFromSheet(grids, CLIENT_LABEL_ROWS)).toThrow(
      new Error(`Account Teams sheet tab "${tab}" header row must be exactly: ${header.join(", ")}.`)
    );
  });

  it("accepts the exact header with trailing blank cells", () => {
    const grids = { people: [[...PEOPLE_HEADER, "", undefined], ...PEOPLE_GRID.slice(1)], teams: TEAMS_GRID };
    expect(() => staffingFromSheet(grids, CLIENT_LABEL_ROWS)).not.toThrow();
  });
});

describe("an inactive or unknown person is skipped and counted", () => {
  it("skips the row for resolution and keeps it for the count", () => {
    const staffing = staffingFromSheet(GRIDS, CLIENT_LABEL_ROWS);
    expect(staffing.clients.northwind.skippedPeople).toEqual(["Motion: Esker, not active", "Strategy: Zephyr, not in People"]);
    expect(staffing.clients.northwind.ignoredTeamParts).toEqual(["Lead: Quill"]);
    expect(staffing.clients.northwind.team.map((p) => p.name)).not.toContain("Esker");
    expect(planPeople("Motion", "northwind", staffing)).toEqual(refused("Motion"));
    expect(planPeople("Strategy", "northwind", staffing)).toEqual(refused("Strategy"));
    // "check" is not "yes", so Ossian is not active.
    expect(staffing.members.find((m) => m.firstName === "Ossian")?.isActive).toBe(false);
  });

  it("the run report counts each skipped row", () => {
    const staffing = staffingFromSheet(
      {
        people: PEOPLE_GRID,
        teams: [
          TEAMS_HEADER,
          ["acme", "Acme", "CD", "Wren", "", "synthetic"],
          ["acme", "Acme", "Motion", "Esker", "", "synthetic"],
          ["acme", "Acme", "Strategy", "Zephyr", "", "synthetic"],
          ["acme", "Acme", "PM", "Ossian", "", "synthetic"],
        ],
      },
      [{ slug: "acme", name: "Acme", nicknames: null }]
    );
    const diff = diffSheet(parsedWith([leaf({ resource: "Design" })]), BUNDLE, emptyLedger(), { runId: "run-1", staffing });
    expect(diff.counts["staffing-skipped-people"]).toBe(3);
    expect(renderReport(diff, []).report).toMatch(/\| staffing rows skipped, person not in People or not active \| 3 \|/);
  });
});

describe("the parity prod snapshot freezes staffing from the sheet read", () => {
  let dbPath = "";
  afterEach(() => {
    if (dbPath) cleanupTestDb(dbPath);
  });

  it("freezes the sheet's team and skipped rows, and they survive the round trip", async () => {
    const created = await createTestDb();
    dbPath = created.dbPath;
    await seedTestDb(created.client);
    await created.client.execute(
      "INSERT INTO clients (id, name, slug, nicknames, team, created_at, updated_at) VALUES ('cl-nw', 'Northwind Petro', 'northwind', NULL, 'CD: Juniper', 0, 0)"
    );
    const snapshot = await captureProdSnapshot(created.db, "northwind", { env: ENV, read: syntheticRead() });
    const frozen = snapshot.staffing?.clients.northwind;
    expect(frozen?.team).toContainEqual({ roleTag: "CD", name: "Wren" });
    expect(frozen?.team).not.toContainEqual({ roleTag: "CD", name: "Juniper" });
    expect(frozen?.skippedPeople).toHaveLength(2);

    const path = join(mkdtempSync(join(tmpdir(), "account-teams-snapshot-")), "prod.json");
    writeProdSnapshot(snapshot, path);
    expect(loadProdSnapshot(path).staffing).toEqual(snapshot.staffing);
  });
});
