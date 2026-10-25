/**
 * Column J, RESOURCE, to owner and resources. A label word names a role
 * through the vocabulary, and the role names a person through the client's
 * staffing in Runway. Any part that does not resolve refuses the whole row.
 */
import { dropCiv, normWord, roleTagForCategory, roleTagForWord, WORD_SEPARATORS } from "./role-vocabulary";
import type { ClientStaffing, StaffMember, Staffing } from "./staffing";

export type PeoplePlan =
  | { kind: "no-label" }
  | { kind: "planned"; owner: string; resources: string }
  | { kind: "refused"; unmapped: string[] };

interface Entry {
  roleTag: string;
  person: string;
}

/** Characters that would corrupt a resources string or its role prefix. */
const UNSAFE_IN_ENTRY = /[,:\n]|->|→/;

function isClientLabel(word: string, client: ClientStaffing): boolean {
  const w = normWord(word);
  return [client.name, ...client.nicknames].some((l) => normWord(l) === w);
}

/** The whole cell when it is one client label, else its words. */
export function splitLabels(cell: string, client?: ClientStaffing): string[] {
  const whole = cell.trim();
  if (client && isClientLabel(dropCiv(whole), client)) return [whole];
  return whole
    .split(WORD_SEPARATORS)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function display(m: StaffMember): string {
  return (m.firstName ?? m.name).trim();
}

/** The one active member a team name means, by first, full or record name; null when none or more than one. */
function activeMemberNamed(name: string, members: StaffMember[]): StaffMember | null {
  const n = normWord(name);
  const hits = members.filter(
    (m) => m.isActive && [m.firstName, m.fullName, m.name].some((v) => v != null && normWord(v) === n)
  );
  return hits.length === 1 ? hits[0] : null;
}

/** The one person every team pair for this role names, or null when the role is unstaffed or split. */
function teamPerson(roleTag: string, client: ClientStaffing, members: StaffMember[]): StaffMember | null {
  const named = client.team.filter((p) => p.roleTag === roleTag).map((p) => activeMemberNamed(p.name, members));
  if (named.length === 0 || named.some((m) => m === null)) return null;
  return new Set(named).size === 1 ? named[0] : null;
}

/** The account manager: the one active member leading this client, else the team's AM pair. */
function accountManager(slug: string, client: ClientStaffing, members: StaffMember[]): StaffMember | null {
  const leads = members.filter((m) => m.isActive && m.accountsLed.includes(slug));
  if (leads.length === 1) return leads[0];
  const fromTeam = teamPerson("AM", client, members);
  if (leads.length === 0) return fromTeam;
  return fromTeam && leads.includes(fromTeam) ? fromTeam : null;
}

function personForRole(roleTag: string, slug: string, client: ClientStaffing, members: StaffMember[]): StaffMember | null {
  return roleTag === "AM" ? accountManager(slug, client, members) : teamPerson(roleTag, client, members);
}

/** A label that is an active member's first name: their role on this client's team, else their role category. */
function namedPerson(word: string, client: ClientStaffing, members: StaffMember[]): Entry | null {
  const w = normWord(word);
  const hits = members.filter((m) => m.isActive && m.firstName != null && normWord(m.firstName) === w);
  if (hits.length !== 1) return null;
  const member = hits[0];
  const onTeam = client.team.find((p) => activeMemberNamed(p.name, members) === member);
  const roleTag = onTeam?.roleTag ?? roleTagForCategory(member.roleCategory);
  return roleTag ? { roleTag, person: display(member) } : null;
}

function safe(entry: Entry | null): Entry | null {
  if (!entry || !entry.person || UNSAFE_IN_ENTRY.test(entry.person) || UNSAFE_IN_ENTRY.test(entry.roleTag)) return null;
  return entry;
}

/** Owner is the first resolved person, or the account manager on a client row; resources keep label order, one entry per person. */
export function planPeople(resource: string | null, clientSlug: string, staffing: Staffing): PeoplePlan {
  if (!resource || !resource.trim()) return { kind: "no-label" };
  const client = staffing.clients[clientSlug];
  const labels = splitLabels(resource, client);
  if (!client) return { kind: "refused", unmapped: labels };

  const members = staffing.members;
  const entries: Entry[] = [];
  const unmapped: string[] = [];
  let clientRow = false;
  for (const label of labels) {
    const word = dropCiv(label);
    let entry: Entry | null;
    if (isClientLabel(word, client)) {
      clientRow = true;
      entry = safe({ roleTag: "Client", person: client.name.trim() });
    } else {
      const roleTag = roleTagForWord(word);
      const person = roleTag ? personForRole(roleTag, clientSlug, client, members) : null;
      entry = safe(roleTag ? (person ? { roleTag, person: display(person) } : null) : namedPerson(word, client, members));
    }
    if (entry) entries.push(entry);
    else unmapped.push(label);
  }

  const amMember = clientRow ? accountManager(clientSlug, client, members) : null;
  const am = amMember ? safe({ roleTag: "AM", person: display(amMember) }) : null;
  if (clientRow && !am) unmapped.push(...labels.filter((l) => isClientLabel(dropCiv(l), client)));
  if (unmapped.length > 0) return { kind: "refused", unmapped: [...new Set(unmapped)] };

  const owner = am ? am.person : entries[0].person;
  const seen = new Set<string>();
  const kept = entries.filter((e) => {
    const key = normWord(e.person);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { kind: "planned", owner, resources: kept.map((e) => `${e.roleTag}: ${e.person}`).join(", ") };
}
