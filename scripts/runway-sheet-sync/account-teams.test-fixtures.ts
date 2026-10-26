/**
 * A synthetic Civilization Account Teams sheet for tests. Every client and
 * person here is invented, and the sheet id is not a real Drive id.
 */
import { vi } from "vitest";
import { ACCOUNT_TEAMS_ENV, PEOPLE_HEADER, PEOPLE_TAB, TEAMS_HEADER, TEAMS_TAB, type AccountTeamsGrids, type ClientLabelRow } from "./account-teams";
import type { Grid, ReadRange } from "./job-ledger";
import type { StaffingSource } from "./staffing-read";

export const SYNTHETIC_TEAMS_SHEET_ID = "syn-account-teams";

export const PEOPLE_GRID: Grid = [
  PEOPLE_HEADER,
  ["Wren", "Calder", "", "", "CD", "Civilization", "yes", "yes", "synthetic"],
  ["Quill", "Ashby", "", "", "Dev", "Civilization", "yes", "yes", "synthetic"],
  ["Marlo", "Vance", "", "", "AM", "Civilization", "yes", "yes", "synthetic"],
  ["Tobin", "Reyes", "", "", "PM", "Civilization", "yes", "yes", "synthetic"],
  ["Esker", "Moss", "", "", "AM", "Civilization", "no", "yes", "synthetic"],
  ["Juniper", "Hale", "", "", "Strategy", "Civilization", "yes", "yes", "synthetic"],
  ["Ossian", "Pratt", "", "", "Leadership", "Civilization", "check", "no", "synthetic"],
];

export const TEAMS_GRID: Grid = [
  TEAMS_HEADER,
  ["northwind", "Northwind Petro", "CD", "Wren", "", "synthetic"],
  ["northwind", "Northwind Petro", "Dev", "Quill", "", "synthetic"],
  ["northwind", "Northwind Petro", "QA", "Quill", "", "synthetic"],
  ["northwind", "Northwind Petro", "PM", "Tobin", "", "synthetic"],
  ["northwind", "Northwind Petro", "AM", "Marlo", "", "synthetic"],
  ["northwind", "Northwind Petro", "Motion", "Esker", "inactive", "synthetic"],
  ["northwind", "Northwind Petro", "Strategy", "Zephyr", "not in People", "synthetic"],
  ["northwind", "Northwind Petro", "Lead", "Quill", "not a role", "synthetic"],
  ["emptyco", "Emptyco", "AM", "Marlo", "", "synthetic"],
  ["teamam", "Teamam Labs", "AM", "Tobin", "", "synthetic"],
  ["teamam", "Teamam Labs", "CD", "Wren", "", "synthetic"],
];

export const GRIDS: AccountTeamsGrids = { people: PEOPLE_GRID, teams: TEAMS_GRID };

export const CLIENT_LABEL_ROWS: ClientLabelRow[] = [
  { slug: "northwind", name: "Northwind Petro", nicknames: JSON.stringify(["NWP", "Northwind"]) },
  { slug: "emptyco", name: "Emptyco", nicknames: JSON.stringify(["EMP"]) },
  { slug: "teamam", name: "Teamam Labs", nicknames: null },
];

/** A ReadRange over the synthetic tabs, recording each range it is asked for. */
export function syntheticRead(grids: AccountTeamsGrids = GRIDS, calls: string[] = []): ReadRange {
  return async (sheetId, range) => {
    calls.push(`${sheetId} ${range}`);
    if (range.startsWith(`'${PEOPLE_TAB}'`)) return grids.people;
    if (range.startsWith(`'${TEAMS_TAB}'`)) return grids.teams;
    throw new Error(`synthetic sheet has no range ${range}`);
  };
}

export const SYNTHETIC_SOURCE: StaffingSource = {
  env: { [ACCOUNT_TEAMS_ENV]: SYNTHETIC_TEAMS_SHEET_ID },
  read: syntheticRead(),
};

/** For a vi.mock of staffing-read: the real loader, spied, reading the synthetic sheet. */
export function loaderOverSyntheticSheet(real: typeof import("./staffing-read")): typeof import("./staffing-read") {
  return { ...real, loadStaffing: vi.fn((db: Parameters<typeof real.loadStaffing>[0]) => real.loadStaffing(db, SYNTHETIC_SOURCE)) };
}
