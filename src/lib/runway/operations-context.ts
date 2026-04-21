/**
 * Runway Context Operations — team, contacts, updates history
 *
 * Contextual read operations for team members, client contacts,
 * and update history. Used by MCP server and Slack bot.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { clients as clientsTable, projects, updates, teamMembers } from "@/lib/db/runway-schema";
import { eq, desc } from "drizzle-orm";
import { getClientBySlug, getClientNameMap, matchesSubstring } from "./operations";

function safeJsonParse<T>(json: string | null, defaultValue: T): T {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

function parseJsonArray(json: string | null): string[] {
  return safeJsonParse<string[]>(json, []);
}

export interface GetUpdatesDataOptions {
  clientSlug?: string;
  limit?: number;
  /** Lower bound on createdAt (inclusive). ISO string. v4 (2026-04-21). */
  since?: string;
  /** Upper bound on createdAt (inclusive). ISO string. v4 (2026-04-21). */
  until?: string;
  /** Filter to updates tagged with this batchId. v4 (2026-04-21). */
  batchId?: string;
  /** Exact match on update_type column. v4 (2026-04-21). */
  updateType?: string;
  /** Case-insensitive substring match against the linked project name. v4 (2026-04-21). */
  projectName?: string;
}

export async function getUpdatesData(opts?: GetUpdatesDataOptions) {
  const db = getRunwayDb();
  const limit = opts?.limit ?? 20;
  const clientNameById = await getClientNameMap();

  // Fetch unbounded-ordered updates and filter in JS. v4 filters are additive
  // and mostly low-cardinality; a full table scan is acceptable at current
  // volume and keeps the WHERE clause composition simple. Apply limit after
  // all filters so callers get up to `limit` post-filter rows.
  let updateList = await db
    .select()
    .from(updates)
    .orderBy(desc(updates.createdAt));

  if (opts?.clientSlug) {
    const client = await getClientBySlug(opts.clientSlug);
    if (client) {
      updateList = updateList.filter((u) => u.clientId === client.id);
    }
  }

  if (opts?.since) {
    const sinceDate = new Date(opts.since);
    updateList = updateList.filter(
      (u) => u.createdAt != null && u.createdAt >= sinceDate
    );
  }

  if (opts?.until) {
    const untilDate = new Date(opts.until);
    updateList = updateList.filter(
      (u) => u.createdAt != null && u.createdAt <= untilDate
    );
  }

  if (opts?.batchId) {
    updateList = updateList.filter((u) => u.batchId === opts.batchId);
  }

  if (opts?.updateType) {
    updateList = updateList.filter((u) => u.updateType === opts.updateType);
  }

  if (opts?.projectName) {
    // Resolve project name map lazily — only fetched when the filter is active.
    const allProjects = await db.select().from(projects);
    const projectNameById = new Map(allProjects.map((p) => [p.id, p.name]));
    updateList = updateList.filter((u) => {
      if (!u.projectId) return false;
      return matchesSubstring(projectNameById.get(u.projectId), opts.projectName!);
    });
  }

  // Truncate post-filter.
  updateList = updateList.slice(0, limit);

  return updateList.map((u) => ({
    client: u.clientId ? clientNameById.get(u.clientId) ?? null : null,
    updatedBy: u.updatedBy,
    updateType: u.updateType,
    previousValue: u.previousValue,
    newValue: u.newValue,
    summary: u.summary,
    createdAt: u.createdAt?.toISOString(),
  }));
}

export async function getTeamMembersData() {
  const db = getRunwayDb();
  const members = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.isActive, 1));

  return members.map((m) => ({
    name: m.name,
    firstName: m.firstName,
    title: m.title,
    roleCategory: m.roleCategory,
    accountsLed: parseJsonArray(m.accountsLed),
    channelPurpose: m.channelPurpose,
  }));
}

export interface TeamMemberRecord {
  name: string;
  firstName: string | null;
  title: string | null;
  roleCategory: string | null;
  accountsLed: string[];
}

export async function getClientContacts(clientSlug: string) {
  const client = await getClientBySlug(clientSlug);
  if (!client) return null;

  const contacts = client.clientContacts
    ? safeJsonParse<string[]>(client.clientContacts, [client.clientContacts])
    : [];

  return { client: client.name, contacts };
}

async function findTeamMemberBySlackId(slackUserId: string) {
  const db = getRunwayDb();
  return db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.slackUserId, slackUserId))
    .get();
}

export async function getTeamMemberBySlackId(
  slackUserId: string
): Promise<string | null> {
  const member = await findTeamMemberBySlackId(slackUserId);
  return member?.name ?? null;
}

export async function getTeamMemberRecordBySlackId(
  slackUserId: string
): Promise<TeamMemberRecord | null> {
  const member = await findTeamMemberBySlackId(slackUserId);
  if (!member) return null;
  return {
    name: member.name,
    firstName: member.firstName,
    title: member.title,
    roleCategory: member.roleCategory,
    accountsLed: parseJsonArray(member.accountsLed),
  };
}

// ── Enriched queries for bot context ──────────────────────

export interface TeamRosterEntry {
  name: string;
  firstName: string | null;
  fullName: string | null;
  title: string | null;
  roleCategory: string | null;
  accountsLed: string[];
  nicknames: string[];
  isActive: number;
}

/** Returns full team member data for bot context building. */
export async function getTeamRosterForContext(): Promise<TeamRosterEntry[]> {
  const db = getRunwayDb();
  const members = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.isActive, 1));
  return members.map((m) => ({
    name: m.name,
    firstName: m.firstName,
    fullName: m.fullName ?? null,
    title: m.title,
    roleCategory: m.roleCategory,
    accountsLed: parseJsonArray(m.accountsLed),
    nicknames: parseJsonArray(m.nicknames ?? null),
    isActive: m.isActive,
  }));
}

export interface ClientMapEntry {
  slug: string;
  name: string;
  nicknames: string[];
  contacts: Array<{ name: string; role?: string }>;
}

/** Returns client map for bot context (slugs, names, nicknames, contacts). */
export async function getClientMapForContext(): Promise<ClientMapEntry[]> {
  const db = getRunwayDb();
  const allClients = await db.select().from(clientsTable);
  return allClients.map((c) => ({
    slug: c.slug,
    name: c.name,
    nicknames: parseJsonArray(c.nicknames ?? null),
    contacts: c.clientContacts ? safeParseContacts(c.clientContacts) : [],
  }));
}

function safeParseContacts(json: string): Array<{ name: string; role?: string }> {
  return safeJsonParse<Array<{ name: string; role?: string }>>(json, []);
}

/** Returns structured client contacts with roles. */
export async function getClientContactsStructured(
  clientSlug: string
): Promise<Array<{ name: string; role?: string }>> {
  const client = await getClientBySlug(clientSlug);
  if (!client?.clientContacts) return [];
  return safeParseContacts(client.clientContacts);
}
