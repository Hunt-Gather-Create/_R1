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
  generateId,
  getClientOrFail,
  resolveProjectOrFail,
  checkDuplicate,
  insertAuditRecord,
  validateAndResolveField,
  getPreviousValue,
  normalizeResourcesString,
  validateParentProjectIdAssignment,
} from "./operations-utils";
import type {
  CascadedItemInfo,
  MutationResponse,
  UpdateProjectFieldData,
} from "./mutation-response";

// ── Delete Project ──────────────────────────────────────

export interface DeleteProjectParams {
  clientSlug: string;
  projectName: string;
  updatedBy: string;
}

// FK deletion pattern — see docs/runway-fk-deletion-pattern.md
export async function deleteProject(
  params: DeleteProjectParams
): Promise<MutationResponse<{ clientName: string; projectName: string }>> {
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
    data: { clientName: client.name, projectName: project.name },
  });
  if (dup) return dup as MutationResponse<{ clientName: string; projectName: string }>;

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
  /**
   * New field value. `null` is a first-class write — stored as SQL NULL,
   * audit-logged with `newValue = "(null)"` and an idempotency key that
   * also uses `"(null)"` so repeat null writes collapse. v4 convention
   * treats NULL as a canonical state (e.g., L2 status NULL = scheduled).
   */
  newValue: string | null;
  updatedBy: string;
}

export async function updateProjectField(
  params: UpdateProjectFieldParams
): Promise<MutationResponse<UpdateProjectFieldData>> {
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

  // v4 (Chunk 5): normalize resources string on write so storage is canonical.
  // Null short-circuits the normalizer so null-to-null writes (and explicit
  // null clears) flow through unchanged.
  const effectiveNewValue: string | null =
    typedField === "resources" && newValue !== null
      ? normalizeResourcesString(newValue)
      : newValue;

  // v4 (PR #88 Chunk F): parentProjectId accepts empty string as "clear".
  // Stored as NULL so `getProjectsFiltered({ parentProjectId: '__null__' })`
  // and the UI's "no wrapper" checks work uniformly. contractStart /
  // contractEnd / engagementType also accept "" as "clear" → null.
  const persistedValue =
    (typedField === "parentProjectId" ||
      typedField === "contractStart" ||
      typedField === "contractEnd" ||
      typedField === "engagementType") &&
    effectiveNewValue === ""
      ? null
      : effectiveNewValue;

  // parentProjectId validators (shared module): both this path and the
  // set_project_parent MCP tool route through validateParentProjectIdAssignment
  // so cycle / non-retainer / cross-client parents always reject.
  if (typedField === "parentProjectId") {
    const parentValidation = await validateParentProjectIdAssignment(db, {
      childId: project.id,
      childClientId: project.clientId,
      newParentId: persistedValue,
    });
    if (!parentValidation.ok) {
      return { ok: false, error: parentValidation.error };
    }
  }

  // Helper-level contract-date invariant. Single-field updates fetch the
  // OTHER side from `project` (already in scope) and reject if the result
  // would put end ≤ start. If the OTHER side is null, no comparison is
  // possible and the write is allowed. Clears (persistedValue === null)
  // skip the check entirely.
  if (typedField === "contractStart" && persistedValue !== null) {
    const otherEnd = project.contractEnd;
    if (otherEnd !== null && persistedValue >= otherEnd) {
      return {
        ok: false,
        error: `contractStart '${persistedValue}' must be < contractEnd '${otherEnd}'.`,
      };
    }
  }
  if (typedField === "contractEnd" && persistedValue !== null) {
    const otherStart = project.contractStart;
    if (otherStart !== null && persistedValue <= otherStart) {
      return {
        ok: false,
        error: `contractEnd '${persistedValue}' must be > contractStart '${otherStart}'.`,
      };
    }
  }

  // Stable idempotency key for null writes — mirrors the "(null)" marker
  // used in audit rows so repeat applies collapse.
  const idemNewValue = effectiveNewValue ?? "(null)";
  const idemKey = generateIdempotencyKey(
    "field-change",
    project.id,
    field,
    idemNewValue,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Update already applied (duplicate request).",
    data: {
      clientName: client.name,
      projectName: project.name,
      field,
      previousValue,
      newValue: effectiveNewValue,
      cascadedItems: [],
      cascadeDetail: [],
    },
  });
  if (dup) return dup as MutationResponse<UpdateProjectFieldData>;

  // Pre-generate parent audit id so cascade rows can link via triggeredByUpdateId.
  const parentAuditId = generateId();

  // Wrap project update + cascade in a single transaction for atomicity.
  // Track cascaded week-item ids + prior dates for audit rows and for the
  // structured `cascadeDetail` (PR #86).
  const cascadedItems: string[] = [];
  const cascadedIds: string[] = [];
  const cascadedPrevDates: Array<string | null> = [];

  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ [columnKey]: persistedValue, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    // Cascade dueDate changes to linked deadline week items
    if (typedField === "dueDate") {
      const linkedDeadlines = await getLinkedDeadlineItems(project.id);
      for (const item of linkedDeadlines) {
        await tx
          .update(weekItems)
          .set({ date: effectiveNewValue, updatedAt: new Date() })
          .where(eq(weekItems.id, item.id));
        cascadedItems.push(item.title);
        cascadedIds.push(item.id);
        // v4 / PR #86: capture prior `date` so cascadeDetail can surface
        // previousValue → newValue for each L2. `date` may be absent on
        // legacy rows; null is the correct "was unset" value.
        const prev =
          (item as { date?: string | null }).date ?? null;
        cascadedPrevDates.push(prev);
      }
    }
  });

  if (cascadedItems.length > 0) {
    console.log(JSON.stringify({
      event: "runway_cascade_forward",
      projectId: project.id,
      field: "dueDate",
      newValue: effectiveNewValue,
      cascadedItems,
    }));
  }

  // For audit summaries and idempotency keys, surface null as the literal
  // "(null)" marker so humans and re-run collapsing both have something stable.
  const summaryNewValue = effectiveNewValue ?? "(null)";

  await insertAuditRecord({
    id: parentAuditId,
    idempotencyKey: idemKey,
    projectId: project.id,
    clientId: client.id,
    updatedBy,
    updateType: "field-change",
    previousValue,
    newValue: effectiveNewValue,
    summary: `${client.name} / ${project.name}: ${field} changed from "${previousValue}" to "${summaryNewValue}"`,
    metadata: JSON.stringify({ field }),
  });

  // v4 §8: emit child audit rows for each cascaded week item, linked to parent.
  // Capture each child's audit id for the structured `cascadeDetail`
  // response field (PR #86).
  const cascadeDetail: CascadedItemInfo[] = [];
  for (let i = 0; i < cascadedIds.length; i++) {
    const itemId = cascadedIds[i];
    const itemTitle = cascadedItems[i];
    const prevDate = cascadedPrevDates[i];
    const childIdemKey = generateIdempotencyKey(
      "cascade-duedate",
      parentAuditId,
      itemId,
      idemNewValue
    );
    const childAuditId = await insertAuditRecord({
      idempotencyKey: childIdemKey,
      projectId: project.id,
      clientId: client.id,
      updatedBy,
      updateType: "cascade-duedate",
      previousValue: null,
      newValue: effectiveNewValue,
      summary: `Cascaded from ${project.name} dueDate change: ${itemTitle} → ${summaryNewValue}`,
      metadata: JSON.stringify({ weekItemId: itemId, field: "date" }),
      triggeredByUpdateId: parentAuditId,
    });
    cascadeDetail.push({
      itemId,
      itemTitle,
      field: "date",
      previousValue: prevDate,
      newValue: effectiveNewValue,
      auditId: childAuditId,
    });
  }

  return {
    ok: true,
    message: `Updated ${field} for ${client.name} / ${project.name}.`,
    data: {
      clientName: client.name,
      projectName: project.name,
      field,
      previousValue,
      newValue: effectiveNewValue,
      cascadedItems,
      cascadeDetail,
      auditId: parentAuditId,
    },
  };
}
