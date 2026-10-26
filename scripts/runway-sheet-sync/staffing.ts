/**
 * Staffing as the sync reads it: each client's team and nicknames, and the
 * team members. The run loads it once from the Account Teams sheet and passes it in.
 */
import { roleTagForWord } from "./role-vocabulary";

export interface StaffMember {
  name: string;
  firstName: string | null;
  fullName: string | null;
  roleCategory: string | null;
  /** Client slugs this person leads as account manager. */
  accountsLed: string[];
  isActive: boolean;
}

/** One role and person on a client's team, its role already a vocabulary tag. */
export interface TeamPair {
  roleTag: string;
  name: string;
}

export interface ClientStaffing {
  name: string;
  nicknames: string[];
  team: TeamPair[];
  /** Team parts whose role is not in the vocabulary, kept for the report count. */
  ignoredTeamParts: string[];
  /** Account Teams rows whose person is not in People or not active, kept for the report count. */
  skippedPeople?: string[];
}

export interface Staffing {
  /** Keyed by client slug. */
  clients: Record<string, ClientStaffing>;
  members: StaffMember[];
  /** Account Teams rows whose client slug is not in the Runway clients table, counted on every sheet's report. */
  skippedRows?: string[];
}

export const NO_STAFFING: Staffing = { clients: {}, members: [] };

export interface ClientRow {
  slug: string;
  name: string;
  nicknames: string | null;
  team: string | null;
}

export interface MemberRow {
  name: string;
  firstName: string | null;
  fullName: string | null;
  roleCategory: string | null;
  accountsLed: string | null;
  isActive: number | boolean | null;
}

/** A JSON array of strings, or empty when the cell is blank or malformed. */
export function jsonStrings(raw: string | null): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
  } catch {
    return [];
  }
}

/** Parses "CD: Ana, Dev: Bo"; any part that is not a pair with a vocabulary role is ignored and returned. */
export function parseTeam(team: string | null): { pairs: TeamPair[]; ignored: string[] } {
  const pairs: TeamPair[] = [];
  const ignored: string[] = [];
  for (const part of (team ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const colon = part.indexOf(":");
    const roleTag = colon > 0 ? roleTagForWord(part.slice(0, colon)) : null;
    const name = colon > 0 ? part.slice(colon + 1).trim() : "";
    if (roleTag && name) pairs.push({ roleTag, name });
    else ignored.push(part);
  }
  return { pairs, ignored };
}

export function staffingFromRows(clientRows: ClientRow[], memberRows: MemberRow[]): Staffing {
  const clients: Record<string, ClientStaffing> = {};
  for (const row of clientRows) {
    const { pairs, ignored } = parseTeam(row.team);
    clients[row.slug] = { name: row.name, nicknames: jsonStrings(row.nicknames), team: pairs, ignoredTeamParts: ignored };
  }
  const members = memberRows.map((m) => ({
    name: m.name,
    firstName: m.firstName,
    fullName: m.fullName,
    roleCategory: m.roleCategory,
    accountsLed: jsonStrings(m.accountsLed),
    isActive: m.isActive === true || m.isActive === 1,
  }));
  return { clients, members };
}
