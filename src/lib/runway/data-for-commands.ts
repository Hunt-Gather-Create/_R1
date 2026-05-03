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
import { eq } from "drizzle-orm";

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
 * id when the slash arg includes a known client slug -> id mapping.
 */
export async function getProjectsForFuzzy(
  clientId?: string,
): Promise<ProjectForFuzzy[]> {
  const db = getRunwayDb();
  const rows = clientId
    ? await db.select().from(projects).where(eq(projects.clientId, clientId))
    : await db.select().from(projects);
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

export async function getTeamMembersForFuzzy(): Promise<TeamMemberForFuzzy[]> {
  const db = getRunwayDb();
  const rows = await db.select().from(teamMembers);
  return rows.map((t) => ({
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
