/**
 * Runway Write Operations — project field updates and delete
 *
 * Handles updates to individual project fields (name, dueDate, owner, etc.)
 * and project deletion, with idempotency checks and audit logging.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, weekItems, updates } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";
import { getLinkedDeadlineItems } from "./operations-reads-week";
import {
  PROJECT_FIELDS,
  PROJECT_FIELD_TO_COLUMN,
  generateIdempotencyKey,
  getClientOrFail,
  resolveProjectOrFail,
  checkDuplicate,
  insertAuditRecord,
  validateAndResolveField,
  getPreviousValue,
} from "./operations-utils";
import type { OperationResult } from "./operations-utils";

// ── Delete Project ──────────────────────────────────────

export interface DeleteProjectParams {
  clientSlug: string;
  projectName: string;
  updatedBy: string;
}

export async function deleteProject(
  params: DeleteProjectParams
): Promise<OperationResult> {
  const { clientSlug, projectName, updatedBy } = params;
  const db = getRunwayDb();

  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const { client } = lookup;

  const projectLookup = await resolveProjectOrFail(client.id, client.name, projectName);
  if (!projectLookup.ok) return projectLookup;
  const project = projectLookup.project;

  const idemKey = generateIdempotencyKey(
    "delete-project",
    project.id,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Project already deleted (duplicate request).",
  });
  if (dup) return dup;

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: project.id,
    clientId: client.id,
    updatedBy,
    updateType: "delete-project",
    previousValue: project.name,
    summary: `Deleted project from ${client.name}: ${project.name}`,
  });

  // Unlink week items, null out audit FK references, then delete project.
  // Audit records are preserved (projectId nulled, clientId + summary intact).
  await db.transaction(async (tx) => {
    await tx
      .update(weekItems)
      .set({ projectId: null, updatedAt: new Date() })
      .where(eq(weekItems.projectId, project.id));

    await tx
      .update(updates)
      .set({ projectId: null })
      .where(eq(updates.projectId, project.id));

    await tx
      .delete(projects)
      .where(eq(projects.id, project.id));
  });

  return {
    ok: true,
    message: `Deleted project '${project.name}' from ${client.name}.`,
    data: { clientName: client.name, projectName: project.name },
  };
}

// ── Update Project Field ────────────────────────────────

export interface UpdateProjectFieldParams {
  clientSlug: string;
  projectName: string;
  field: string;
  newValue: string;
  updatedBy: string;
}

export async function updateProjectField(
  params: UpdateProjectFieldParams
): Promise<OperationResult> {
  const { clientSlug, projectName, field, newValue, updatedBy } = params;
  const db = getRunwayDb();

  const fieldResult = validateAndResolveField(field, PROJECT_FIELDS, PROJECT_FIELD_TO_COLUMN);
  if (!fieldResult.ok) return fieldResult;
  const { typedField, columnKey } = fieldResult;

  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const { client } = lookup;

  const projectLookup = await resolveProjectOrFail(client.id, client.name, projectName);
  if (!projectLookup.ok) return projectLookup;
  const project = projectLookup.project;

  const previousValue = getPreviousValue(project, columnKey);

  const idemKey = generateIdempotencyKey(
    "field-change",
    project.id,
    field,
    newValue,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Update already applied (duplicate request).",
    data: { clientName: client.name, projectName: project.name, field, previousValue, newValue },
  });
  if (dup) return dup;

  // Wrap project update + cascade in a single transaction for atomicity
  const cascadedItems: string[] = [];

  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ [columnKey]: newValue, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    // Cascade dueDate changes to linked deadline week items
    if (typedField === "dueDate") {
      const linkedDeadlines = await getLinkedDeadlineItems(project.id);
      for (const item of linkedDeadlines) {
        await tx
          .update(weekItems)
          .set({ date: newValue, updatedAt: new Date() })
          .where(eq(weekItems.id, item.id));
        cascadedItems.push(item.title);
      }
    }
  });

  if (cascadedItems.length > 0) {
    console.log(JSON.stringify({
      event: "runway_cascade_forward",
      projectId: project.id,
      field: "dueDate",
      newValue,
      cascadedItems,
    }));
  }

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: project.id,
    clientId: client.id,
    updatedBy,
    updateType: "field-change",
    previousValue,
    newValue,
    summary: `${client.name} / ${project.name}: ${field} changed from "${previousValue}" to "${newValue}"`,
    metadata: JSON.stringify({ field }),
  });

  return {
    ok: true,
    message: `Updated ${field} for ${client.name} / ${project.name}.`,
    data: {
      clientName: client.name,
      projectName: project.name,
      field,
      previousValue,
      newValue,
      cascadedItems,
    },
  };
}
