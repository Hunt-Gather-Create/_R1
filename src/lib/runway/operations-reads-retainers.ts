/**
 * Runway Read Operations — Retainer wrapper team aggregation.
 *
 * Answers "who is on the Convergix Retainer team" in a single helper
 * call so the bot + MCP don't need to multi-step parse `resources` and
 * dedupe names across children.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, clients } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";

export interface RetainerTeamMember {
  name: string;
  /** Each appearance as `"{role} ({childProjectName})"`. */
  roles: string[];
  /** Child L1 ids where this person appears. */
  childProjectIds: string[];
}

export interface RetainerTeamResult {
  wrapperId: string;
  wrapperName: string;
  clientName: string;
  childProjectCount: number;
  team: RetainerTeamMember[];
  /** Wrapper's own `owner` (e.g., retainer manager). Null when unset. */
  owner: string | null;
}

const ROLE_PREFIX_PATTERN = /^([A-Za-z]+):\s*(.+)$/;

function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

function parseResources(resources: string | null | undefined): Array<{ role: string; name: string }> {
  if (!resources) return [];
  const parts = resources.split(/[,;\n]/);
  const out: Array<{ role: string; name: string }> = [];
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const match = ROLE_PREFIX_PATTERN.exec(trimmed);
    if (match) {
      out.push({ role: match[1], name: match[2].trim() });
    } else {
      out.push({ role: "Resource", name: trimmed });
    }
  }
  return out;
}

/**
 * Return the deduplicated working team under a retainer wrapper.
 *
 * Wrapper's own `owner` is returned separately from `team` so callers
 * can distinguish "who manages the retainer" from "who does the work".
 *
 * @param wrapperId The retainer wrapper's project id.
 * @returns A `RetainerTeamResult` on success, or `{ error }` when the id
 *   doesn't exist or the project isn't a retainer.
 */
export async function getRetainerTeam(
  wrapperId: string,
): Promise<RetainerTeamResult | { error: string }> {
  const db = getRunwayDb();

  const wrapperRows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, wrapperId));
  const wrapper = wrapperRows[0];
  if (!wrapper) {
    return { error: `Not a retainer wrapper: project id '${wrapperId}' not found` };
  }
  if (wrapper.engagementType !== "retainer") {
    return { error: "Not a retainer wrapper" };
  }

  const clientRows = await db
    .select()
    .from(clients)
    .where(eq(clients.id, wrapper.clientId));
  const clientName = clientRows[0]?.name ?? "Unknown";

  const children = await db
    .select()
    .from(projects)
    .where(eq(projects.parentProjectId, wrapperId));

  const byName = new Map<string, RetainerTeamMember>();
  for (const child of children) {
    const entries: Array<{ role: string; name: string }> = [];
    if (child.owner) entries.push({ role: "Owner", name: child.owner });
    entries.push(...parseResources(child.resources));
    for (const { role, name } of entries) {
      if (!name) continue;
      const key = normalizeName(name);
      if (key === "") continue;
      let member = byName.get(key);
      if (!member) {
        member = { name: name.trim(), roles: [], childProjectIds: [] };
        byName.set(key, member);
      }
      member.roles.push(`${role} (${child.name})`);
      if (!member.childProjectIds.includes(child.id)) {
        member.childProjectIds.push(child.id);
      }
    }
  }

  const team = [...byName.values()].sort((a, b) => {
    if (a.roles.length !== b.roles.length) return b.roles.length - a.roles.length;
    return a.name.localeCompare(b.name);
  });

  return {
    wrapperId: wrapper.id,
    wrapperName: wrapper.name,
    clientName,
    childProjectCount: children.length,
    team,
    owner: wrapper.owner ?? null,
  };
}
