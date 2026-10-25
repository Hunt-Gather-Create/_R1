/**
 * Synthetic staffing for tests. Every client and person here is invented.
 */
import { staffingFromRows, type ClientRow, type MemberRow } from "./staffing";

export const CLIENT_ROWS: ClientRow[] = [
  {
    slug: "northwind",
    name: "Northwind Petro",
    nicknames: JSON.stringify(["NWP", "Northwind"]),
    team: "CD: Wren, Dev: Quill, QA: Quill, PM: Tobin, Motion: Esker, Wren Calder (lead), Lead: Quill",
  },
  { slug: "emptyco", name: "Emptyco", nicknames: JSON.stringify(["EMP"]), team: null },
  { slug: "teamam", name: "Teamam Labs", nicknames: null, team: "AM: Tobin Reyes, CD: Wren" },
];

function member(firstName: string, last: string, roleCategory: string, accountsLed: string[] = [], isActive = 1): MemberRow {
  return {
    name: `${firstName} ${last}`,
    firstName,
    fullName: `${firstName} ${last}`,
    roleCategory,
    accountsLed: JSON.stringify(accountsLed),
    isActive,
  };
}

export const MEMBER_ROWS: MemberRow[] = [
  member("Wren", "Calder", "creative"),
  member("Quill", "Ashby", "dev"),
  member("Marlo", "Vance", "am", ["northwind", "emptyco"]),
  member("Tobin", "Reyes", "pm"),
  member("Esker", "Moss", "am", ["northwind", "teamam"], 0),
  member("Juniper", "Hale", "strategy"),
  member("Ossian", "Pratt", "leadership"),
];

export const STAFFING = staffingFromRows(CLIENT_ROWS, MEMBER_ROWS);
