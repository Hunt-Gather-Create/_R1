/**
 * Staffing from the Civilization Account Teams sheet: the People tab and the
 * Account Teams tab, each checked against its exact header row. The sheet id
 * is configuration from the environment, never a value in code.
 */
import { readRangeWithCli, type Grid, type ReadRange } from "./job-ledger";
import { normWord, roleTagForWord, vocabularyTags } from "./role-vocabulary";
import { jsonStrings, type ClientStaffing, type StaffMember, type Staffing } from "./staffing";

export const ACCOUNT_TEAMS_ENV = "RUNWAY_ACCOUNT_TEAMS_SHEET_ID";

export const PEOPLE_TAB = "People";
export const TEAMS_TAB = "Account Teams";
export const PEOPLE_HEADER = ["First Name", "Last Name", "Nicknames", "Aliases", "Role", "Org", "Active", "Confirmed", "Source"];
export const TEAMS_HEADER = ["Client Slug", "Client Name", "Role", "Person", "Notes", "Source"];

/** A Runway client's labels; the sheet never names a client for the resolver. */
export interface ClientLabelRow {
  slug: string;
  name: string;
  nicknames: string | null;
}

export interface AccountTeamsGrids {
  people: Grid;
  teams: Grid;
}

export function requireAccountTeamsSheetId(env: NodeJS.ProcessEnv): string {
  const id = env[ACCOUNT_TEAMS_ENV]?.trim();
  if (!id) {
    throw new Error(`${ACCOUNT_TEAMS_ENV} is not set, so staffing cannot be read from the Civilization Account Teams sheet.`);
  }
  return id;
}

const cell = (row: (string | undefined)[], i: number) => (row[i] ?? "").trim();

/** Throws one line naming the tab and the header it expects unless the row matches exactly. */
function checkHeader(grid: Grid, tab: string, expected: string[]): void {
  const header = (grid[0] ?? []).map((c) => (c ?? "").trim());
  while (header.length > 0 && header[header.length - 1] === "") header.pop();
  if (header.length !== expected.length || header.some((h, i) => h !== expected[i])) {
    throw new Error(`Account Teams sheet tab "${tab}" header row must be exactly: ${expected.join(", ")}.`);
  }
}

/** A Role cell as a role tag: a vocabulary word, or a tag the vocabulary emits. */
function roleTagForCell(role: string): string | null {
  return roleTagForWord(role) ?? vocabularyTags().find((t) => normWord(t) === normWord(role)) ?? null;
}

function memberFromPeopleRow(row: (string | undefined)[]): StaffMember {
  const first = cell(row, 0);
  const last = cell(row, 1);
  const full = last ? `${first} ${last}` : first;
  // A person's role comes only from a client's Account Teams row, so there is no category fallback.
  return { name: full, firstName: first, fullName: full, roleCategory: null, accountsLed: [], isActive: cell(row, 6).toLowerCase() === "yes" };
}

export function staffingFromSheet(grids: AccountTeamsGrids, clientRows: ClientLabelRow[]): Staffing {
  checkHeader(grids.people, PEOPLE_TAB, PEOPLE_HEADER);
  checkHeader(grids.teams, TEAMS_TAB, TEAMS_HEADER);

  const members = grids.people.slice(1).filter((row) => cell(row, 0) !== "").map(memberFromPeopleRow);
  const clients: Record<string, ClientStaffing> = {};
  for (const row of clientRows) {
    clients[row.slug] = { name: row.name, nicknames: jsonStrings(row.nicknames), team: [], ignoredTeamParts: [], skippedPeople: [] };
  }

  for (const row of grids.teams.slice(1)) {
    const client = clients[cell(row, 0)];
    const role = cell(row, 2);
    const person = cell(row, 3);
    if (!client || (!role && !person)) continue;
    const text = `${role}: ${person}`;
    const roleTag = roleTagForCell(role);
    if (!roleTag || !person) {
      client.ignoredTeamParts.push(text);
      continue;
    }
    const named = members.filter((m) => m.firstName != null && normWord(m.firstName) === normWord(person));
    const active = named.filter((m) => m.isActive);
    if (active.length === 0) {
      client.skippedPeople!.push(`${text}, ${named.length === 0 ? "not in People" : "not active"}`);
      continue;
    }
    client.team.push({ roleTag, name: person });
    // Every active person an AM row names leads the client, so two active AMs refuse as before.
    if (roleTag === "AM") for (const m of active) if (!m.accountsLed.includes(cell(row, 0))) m.accountsLed.push(cell(row, 0));
  }
  return { clients, members };
}

export async function readAccountTeams(sheetId: string, read: ReadRange = readRangeWithCli): Promise<AccountTeamsGrids> {
  const [people, teams] = await Promise.all([read(sheetId, `'${PEOPLE_TAB}'!A:Z`), read(sheetId, `'${TEAMS_TAB}'!A:Z`)]);
  return { people, teams };
}
