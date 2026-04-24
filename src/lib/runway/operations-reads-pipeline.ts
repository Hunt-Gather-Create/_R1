/**
 * Runway Read Operations — Pipeline & Stale Items queries
 */

import { getRunwayDb } from "@/lib/db/runway";
import {
  projects,
  pipelineItems,
  updates,
} from "@/lib/db/runway-schema";
import { eq, asc, desc } from "drizzle-orm";
import { getClientBySlug, getClientNameMap, matchesSubstring } from "./operations";

export async function getPipelineData() {
  const db = getRunwayDb();
  const clientNameById = await getClientNameMap();

  const items = await db
    .select()
    .from(pipelineItems)
    .orderBy(asc(pipelineItems.sortOrder));

  return items.map((item) => ({
    account: item.clientId
      ? clientNameById.get(item.clientId) ?? null
      : null,
    name: item.name,
    status: item.status,
    estimatedValue: item.estimatedValue,
    waitingOn: item.waitingOn,
    notes: item.notes,
  }));
}

export interface StaleAccountItem {
  clientName: string;
  projectName: string;
  staleDays: number;
  lastUpdate?: string;
}

/**
 * Find stale projects for a set of client slugs.
 *
 * A project is stale when it has no `updates` row in the last 7 days.
 * The returned `staleDays` is computed from `projects.updatedAt` rather
 * than the unwritten `projects.stale_days` column (orphan since v3).
 * Results are sorted by staleness (most stale first).
 */
export async function getStaleItemsForAccounts(
  clientSlugs: string[],
  personName?: string
): Promise<StaleAccountItem[]> {
  if (clientSlugs.length === 0) return [];

  const db = getRunwayDb();
  const results: StaleAccountItem[] = [];

  const now = new Date();
  const nowMs = now.getTime();
  const sevenDaysAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
  const dayMs = 24 * 60 * 60 * 1000;

  for (const slug of clientSlugs) {
    const client = await getClientBySlug(slug);
    if (!client) continue;

    const clientProjects = await db
      .select()
      .from(projects)
      .where(eq(projects.clientId, client.id))
      .orderBy(asc(projects.sortOrder));

    // Get most recent update per project for this client
    const clientUpdates = await db
      .select()
      .from(updates)
      .where(eq(updates.clientId, client.id))
      .orderBy(desc(updates.createdAt));

    const latestUpdateByProject = new Map<string, Date>();
    for (const u of clientUpdates) {
      if (u.projectId && u.createdAt && !latestUpdateByProject.has(u.projectId)) {
        latestUpdateByProject.set(u.projectId, u.createdAt);
      }
    }

    for (const project of clientProjects) {
      // Skip completed and on-hold projects
      if (project.status === "completed" || project.status === "on-hold") continue;

      // Filter by personName if provided — show items they own, resource, or unassigned
      if (personName) {
        const isOwner = matchesSubstring(project.owner, personName);
        const isResource = matchesSubstring(project.resources, personName);
        const isUnassigned = !project.owner && !project.resources;
        if (!isOwner && !isResource && !isUnassigned) continue;
      }

      const lastUpdate = latestUpdateByProject.get(project.id);
      const isStaleByUpdates = !lastUpdate || lastUpdate < sevenDaysAgo;

      if (!isStaleByUpdates) continue;

      // Computed staleness — days since the project row's last write.
      // `projects.updated_at` is NOT NULL at the schema level, so the
      // fallback branch should be unreachable in practice; it's kept
      // defensive against driver quirks or in-flight migrations so
      // consumers like `bot-proactive.ts:34` that filter `staleDays > 0`
      // don't silently drop rows if the value ever lands as nullish.
      const staleDays = project.updatedAt
        ? Math.max(0, Math.floor((nowMs - project.updatedAt.getTime()) / dayMs))
        : 7;

      results.push({
        clientName: client.name,
        projectName: project.name,
        staleDays,
        lastUpdate: lastUpdate?.toISOString(),
      });
    }
  }

  results.sort((a, b) => b.staleDays - a.staleDays);
  return results;
}
