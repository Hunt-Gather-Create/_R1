/**
 * Entity resolution for the Runway Gantt CLI.
 *
 * Resolves a project or client from a name/id input, then classifies the
 * resolved project as a wrapper view (retainer with child L1s) or an L1
 * view (everything else, including sub-projects and degenerate retainers).
 *
 * Pure helpers (`resolveProjectFromList`, `resolveClientFromList`,
 * `classifyProject`) are exported for unit testing without a DB.
 */

import { drizzle } from "drizzle-orm/libsql";
import { and, eq, isNull } from "drizzle-orm";
import { clients, projects } from "@/lib/db/runway-schema";
import {
  classifyProject,
  resolveClientFromList,
  resolveProjectFromList,
} from "../../../src/lib/runway/gantt/resolve-helpers";
import type {
  ResolveClientResult,
  ResolveProjectResult,
} from "../../../src/lib/runway/gantt/types";

export { classifyProject, resolveClientFromList, resolveProjectFromList };

type DrizzleDb = ReturnType<typeof drizzle>;

// ── DB-coupled wrappers ───────────────────────────────────

export async function resolveProject(
  db: DrizzleDb,
  input: string,
): Promise<ResolveProjectResult> {
  const [allClients, allProjects] = await Promise.all([
    db.select().from(clients),
    db.select().from(projects),
  ]);
  const clientsById = new Map(allClients.map((c) => [c.id, c]));

  const result = resolveProjectFromList(allProjects, clientsById, input);
  if (!result.ok) return result;

  const childProjects = allProjects.filter(
    (p) => p.parentProjectId === result.project.id,
  );
  return { ok: true, subject: classifyProject(result.project, childProjects) };
}

export async function resolveClient(
  db: DrizzleDb,
  input: string,
): Promise<ResolveClientResult> {
  const allClients = await db.select().from(clients);
  const result = resolveClientFromList(allClients, input);
  if (!result.ok) return result;

  const topLevelProjects = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.clientId, result.client.id), isNull(projects.parentProjectId)),
    );

  return { ok: true, client: result.client, topLevelProjects };
}
