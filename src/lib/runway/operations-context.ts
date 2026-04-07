/**
 * Runway Context Operations — team, contacts, updates history
 *
 * Contextual read operations for team members, client contacts,
 * and update history. Used by MCP server and Slack bot.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { updates, teamMembers } from "@/lib/db/runway-schema";
import { eq, desc } from "drizzle-orm";
import { getClientBySlug, getClientNameMap } from "./operations";

function parseAccountsLed(json: string | null): string[] {
  if (!json) return [];
  return JSON.parse(json) as string[];
}

export async function getUpdatesData(opts?: {
  clientSlug?: string;
  limit?: number;
}) {
  const db = getRunwayDb();
  const limit = opts?.limit ?? 20;
  const clientNameById = await getClientNameMap();

  let updateList = await db
    .select()
    .from(updates)
    .orderBy(desc(updates.createdAt))
    .limit(limit);

  if (opts?.clientSlug) {
    const client = await getClientBySlug(opts.clientSlug);
    if (client) {
      updateList = updateList.filter((u) => u.clientId === client.id);
    }
  }

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
    accountsLed: parseAccountsLed(m.accountsLed),
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

  let contacts: string[] = [];
  if (client.clientContacts) {
    try {
      contacts = JSON.parse(client.clientContacts);
    } catch {
      contacts = [client.clientContacts];
    }
  }

  return { client: client.name, contacts };
}

export async function getTeamMemberBySlackId(
  slackUserId: string
): Promise<string | null> {
  const db = getRunwayDb();
  const member = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.slackUserId, slackUserId))
    .get();
  return member?.name ?? null;
}

export async function getTeamMemberRecordBySlackId(
  slackUserId: string
): Promise<TeamMemberRecord | null> {
  const db = getRunwayDb();
  const member = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.slackUserId, slackUserId))
    .get();
  if (!member) return null;
  return {
    name: member.name,
    firstName: member.firstName,
    title: member.title,
    roleCategory: member.roleCategory,
    accountsLed: parseAccountsLed(member.accountsLed),
  };
}
