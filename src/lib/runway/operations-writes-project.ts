/**
 * Runway Write Operations — project field updates
 *
 * Handles updates to individual project fields (name, dueDate, owner, etc.)
 * with idempotency checks and audit logging.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";
import {
  PROJECT_FIELDS,
  PROJECT_FIELD_TO_COLUMN,
  generateIdempotencyKey,
  getClientOrFail,
  resolveProjectOrFail,
  checkDuplicate,
  insertAuditRecord,
  validateField,
} from "./operations-utils";
import type { ProjectField } from "./operations-utils";
import type { OperationResult } from "./operations-writes";

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

  const fieldError = validateField(field, PROJECT_FIELDS);
  if (fieldError) return fieldError;

  const typedField = field as ProjectField;

  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const { client } = lookup;

  const projectLookup = await resolveProjectOrFail(client.id, client.name, projectName);
  if (!projectLookup.ok) return projectLookup;
  const project = projectLookup.project;

  const columnKey = PROJECT_FIELD_TO_COLUMN[typedField];
  const previousValue = String(project[columnKey] ?? "");

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

  await db
    .update(projects)
    .set({ [columnKey]: newValue, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

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
    },
  };
}
