/**
 * Thin entity-fetch shims for the slash-commands dispatcher.
 *
 * The route handler needs minimal lists of (id, name, clientId) tuples to
 * feed `fuzzyMatchCandidates`. Defining these wrappers here (instead of
 * reusing the heavier `getProjectsFiltered` / `getTeamMembersData` helpers)
 * keeps the route's import surface small AND lets the route test mock a
 * single module via `vi.doMock`. No business logic — just SELECTs.
 */

import { getRunwayDb } from "@/lib/db/runway";
import {
  projects,
  weekItems,
  teamMembers,
} from "@/lib/db/runway-schema";
import { and, eq } from "drizzle-orm";

export interface ProjectForFuzzy {
  id: string;
  name: string;
  clientId: string;
}

export interface WeekItemForFuzzy {
  id: string;
  title: string;
  clientId: string | null;
  projectId: string | null;
}

export interface TeamMemberForFuzzy {
  id: string;
  name: string;
  fullName: string | null;
  roleCategory: string | null;
}

/**
 * Fetch all projects for fuzzy matching. Optionally narrow to a single client
 * id when the slash arg includes a known client slug -> id mapping. Phase 4
 * adds an optional `engagementType` filter so the Options Load URL can
 * surface retainer-only projects to the project modal's parent_retainer
 * picker.
 */
export async function getProjectsForFuzzy(
  clientId?: string,
  opts?: { engagementType?: string },
): Promise<ProjectForFuzzy[]> {
  const db = getRunwayDb();
  const conditions = [];
  if (clientId) conditions.push(eq(projects.clientId, clientId));
  if (opts?.engagementType) conditions.push(eq(projects.engagementType, opts.engagementType));
  const rows = conditions.length === 0
    ? await db.select().from(projects)
    : conditions.length === 1
    ? await db.select().from(projects).where(conditions[0])
    : await db.select().from(projects).where(and(...conditions));
  return rows.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId }));
}

export async function getWeekItemsForFuzzy(
  clientId?: string,
): Promise<WeekItemForFuzzy[]> {
  const db = getRunwayDb();
  const rows = clientId
    ? await db.select().from(weekItems).where(eq(weekItems.clientId, clientId))
    : await db.select().from(weekItems);
  return rows.map((w) => ({
    id: w.id,
    title: w.title,
    clientId: w.clientId,
    projectId: w.projectId,
  }));
}

export async function getTeamMembersForFuzzy(
  opts?: { excludeRoleCategory?: string },
): Promise<TeamMemberForFuzzy[]> {
  const db = getRunwayDb();
  const rows = await db.select().from(teamMembers);
  const filtered = opts?.excludeRoleCategory
    ? rows.filter((t) => t.roleCategory !== opts.excludeRoleCategory)
    : rows;
  return filtered.map((t) => ({
    id: t.id,
    name: t.name,
    fullName: t.fullName,
    roleCategory: t.roleCategory,
  }));
}

/**
 * Look up a single entity row by id. Returns null if not found. The route
 * uses this when the slash arg looks like a ulid (`/^[a-z0-9_-]{20,}$/`)
 * before falling back to fuzzy name lookup.
 */
export async function getEntityById(
  kind: "project" | "week_item" | "team_member",
  id: string,
): Promise<Record<string, unknown> | null> {
  const db = getRunwayDb();
  if (kind === "project") {
    const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return rows[0] ?? null;
  }
  if (kind === "week_item") {
    const rows = await db.select().from(weekItems).where(eq(weekItems.id, id)).limit(1);
    return rows[0] ?? null;
  }
  const rows = await db.select().from(teamMembers).where(eq(teamMembers.id, id)).limit(1);
  return rows[0] ?? null;
}
