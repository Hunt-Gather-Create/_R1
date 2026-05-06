/**
 * Shared row loader for the Slack modal flows.
 *
 * Both the slash-command route (`/api/slack/commands`) and the interactivity
 * route (`/api/slack/interactivity`) need to fetch a single entity row by id
 * during the edit flow:
 *
 *   - commands route: single-match path, post fuzzy resolution
 *   - interactivity route: multi-match candidate pick, post user selection
 *
 * Keeping this in one module prevents drift between the two call sites and
 * keeps the row -> currentValues conversion (a simple spread) consistent.
 *
 * Wave 6 / Fix 6.11: column projection. SELECT * loaded every column on the
 * row even though the modal builders only consume a small per-kind subset.
 * The column lists below are the full set of fields any of the consumers
 * (modal builders + interactivity rebuild) read off currentValues. Anything
 * not listed is irrelevant to the modal flow and intentionally omitted.
 */
import { getRunwayDb } from "@/lib/db/runway";
import { projects, weekItems, teamMembers } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";

export type EntityKind = "task" | "project" | "team-member";

/**
 * Fetch a single entity row by its primary id. Returns null when no row
 * matches (the entity was deleted, the id was never valid, etc.). The caller
 * decides how to surface that miss to the user.
 *
 * The row shape is the projected drizzle schema row spread into a plain
 * object so downstream code can treat it as a `currentValues` snapshot for
 * the modal builders.
 */
export async function loadEntityById(
  kind: EntityKind,
  id: string,
): Promise<Record<string, unknown> | null> {
  const db = getRunwayDb();
  if (kind === "project") {
    // Columns consumed by buildProjectModal currentValues + interactivity rebuild:
    //   id, name, clientId, status, category, owner, resources,
    //   parentProjectId, engagementType, startDate, endDate, contractStart,
    //   contractEnd, dueDate, notes
    const rows = await db
      .select({
        id: projects.id,
        name: projects.name,
        clientId: projects.clientId,
        status: projects.status,
        category: projects.category,
        owner: projects.owner,
        resources: projects.resources,
        parentProjectId: projects.parentProjectId,
        engagementType: projects.engagementType,
        startDate: projects.startDate,
        endDate: projects.endDate,
        contractStart: projects.contractStart,
        contractEnd: projects.contractEnd,
        dueDate: projects.dueDate,
        notes: projects.notes,
      })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  }
  if (kind === "task") {
    // Columns consumed by buildTaskModal currentValues + interactivity rebuild:
    //   id, title, clientId, projectId, category, status, date, weekOf,
    //   startDate, endDate, dayOfWeek, blockedBy, owner, resources, notes
    const rows = await db
      .select({
        id: weekItems.id,
        title: weekItems.title,
        clientId: weekItems.clientId,
        projectId: weekItems.projectId,
        category: weekItems.category,
        status: weekItems.status,
        date: weekItems.date,
        weekOf: weekItems.weekOf,
        startDate: weekItems.startDate,
        endDate: weekItems.endDate,
        dayOfWeek: weekItems.dayOfWeek,
        blockedBy: weekItems.blockedBy,
        owner: weekItems.owner,
        resources: weekItems.resources,
        notes: weekItems.notes,
      })
      .from(weekItems)
      .where(eq(weekItems.id, id))
      .limit(1);
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  }
  // team-member columns consumed by buildTeamMemberModal:
  //   id, name, fullName, email (none in current schema), roleCategory, isActive
  // Note: `email` is not a column on the teamMembers table in
  // runway-schema.ts - the modal pre-fill reads currentValues.email but the
  // schema has no matching column today, so we omit it from the projection.
  const rows = await db
    .select({
      id: teamMembers.id,
      name: teamMembers.name,
      fullName: teamMembers.fullName,
      roleCategory: teamMembers.roleCategory,
      isActive: teamMembers.isActive,
    })
    .from(teamMembers)
    .where(eq(teamMembers.id, id))
    .limit(1);
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}
