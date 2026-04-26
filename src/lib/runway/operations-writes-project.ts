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
  validateEngagementType,
  validateIsoDateShape,
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

  // Helper-level value validation. The MCP wrapper validates at the tool
  // boundary too (defense-in-depth + better error before dispatch), but
  // batch_apply routes through the helper directly, so this branch is the
  // only enforcement point for those calls. Reuses the shared validators
  // hoisted to operations-utils so MCP wrapper + helper stay in lockstep.
  if (typedField === "engagementType" && newValue !== null) {
    const v = validateEngagementType(newValue);
    if (!v.ok) return { ok: false, error: v.error };
  }
  if (
    (typedField === "contractStart" || typedField === "contractEnd") &&
    newValue !== null
  ) {
    const v = validateIsoDateShape(newValue, typedField);
    if (!v.ok) return { ok: false, error: v.error };
  }

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

// ── Override Project Date ────────────────────────────────

export interface OverrideProjectDateParams {
  clientSlug: string;
  projectName: string;
  field: "startDate" | "endDate";
  /** ISO YYYY-MM-DD or null (clears the column). */
  newValue: string | null;
  updatedBy: string;
  /**
   * Required `true` to override on a retainer wrapper L1 (engagementType =
   * retainer + EXISTS L1 children). Wrappers freeze at SOW dates by default;
   * bypass requires explicit operator intent.
   */
  bypassGuard?: boolean;
}

export interface OverrideProjectDateData extends Record<string, unknown> {
  clientName: string;
  projectName: string;
  field: "startDate" | "endDate";
  previousValue: string | null;
  newValue: string | null;
  auditId: string;
}

/**
 * Bypasses PROJECT_FIELDS whitelist to write start_date / end_date directly.
 * Audit row uses update_type = "date-override" and the idempotency key
 * includes BOTH oldValue and newValue so revert + retry on the same target
 * value (oldValue=A → newValue=B, then revert B → A, then re-fire A → B)
 * generates three distinct keys (per feedback_revert_idempotency_poisoning).
 */
export async function overrideProjectDate(
  params: OverrideProjectDateParams,
): Promise<MutationResponse<OverrideProjectDateData>> {
  const { clientSlug, projectName, field, newValue, updatedBy, bypassGuard } = params;
  const db = getRunwayDb();

  // Helper-level ISO validation — batch_apply routes here directly. The MCP
  // wrapper validates the same way; both reuse the shared validator so the
  // error message is identical regardless of entry point.
  if (newValue !== null) {
    const v = validateIsoDateShape(newValue, field);
    if (!v.ok) return { ok: false, error: v.error };
  }

  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const { client } = lookup;

  const projectLookup = await resolveProjectOrFail(client.id, client.name, projectName);
  if (!projectLookup.ok) return projectLookup;
  const project = projectLookup.project;

  // Wrapper guard: if this project is a retainer with at least one L1 child
  // pointing at it, refuse without explicit bypassGuard=true.
  if (project.engagementType === "retainer") {
    const childRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.parentProjectId, project.id));
    if (childRows.length > 0 && bypassGuard !== true) {
      return {
        ok: false,
        error: `Refusing to override ${field} on retainer wrapper '${project.name}' without bypassGuard=true.`,
      };
    }
  }

  const previousValue =
    field === "startDate" ? project.startDate ?? null : project.endDate ?? null;
  const idemNewValue = newValue ?? "(null)";
  const idemPrevValue = previousValue ?? "(null)";

  const idemKey = generateIdempotencyKey(
    "date-override",
    project.id,
    field,
    idemPrevValue,
    idemNewValue,
    updatedBy,
  );

  const auditId = generateId();
  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Date override already applied (duplicate request).",
    data: {
      clientName: client.name,
      projectName: project.name,
      field,
      previousValue,
      newValue,
      auditId,
    },
  });
  if (dup) return dup as MutationResponse<OverrideProjectDateData>;

  const columnKey = field === "startDate" ? "startDate" : "endDate";
  await db
    .update(projects)
    .set({ [columnKey]: newValue, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  await insertAuditRecord({
    id: auditId,
    idempotencyKey: idemKey,
    projectId: project.id,
    clientId: client.id,
    updatedBy,
    updateType: "date-override",
    previousValue,
    newValue,
    summary: `${client.name} / ${project.name}: ${field} override "${idemPrevValue}" -> "${idemNewValue}"`,
    metadata: JSON.stringify({ field }),
  });

  return {
    ok: true,
    message: `Overrode ${field} for ${client.name} / ${project.name}.`,
    data: {
      clientName: client.name,
      projectName: project.name,
      field,
      previousValue,
      newValue,
      auditId,
    },
  };
}

// ── Set Project Parent ───────────────────────────────────

export interface SetProjectParentParams {
  clientSlug: string;
  projectName: string;
  /** Wrapper project name (same client, must be retainer); null clears. */
  parentProjectName: string | null;
  updatedBy: string;
}

/**
 * Resolves the parent project by name within the same client and routes
 * through `updateProjectField({ field: "parentProjectId", newValue: <id|""> })`,
 * which in turn calls validateParentProjectIdAssignment. Defense in depth:
 * the tool resolves + validates here, and the helper revalidates via the
 * shared module so any direct-helper caller is also covered.
 */
export async function setProjectParent(
  params: SetProjectParentParams,
): Promise<MutationResponse<UpdateProjectFieldData>> {
  const { clientSlug, projectName, parentProjectName, updatedBy } = params;

  if (parentProjectName === null) {
    // Clear via empty string (PR 88 Chunk F coercion).
    return updateProjectField({
      clientSlug,
      projectName,
      field: "parentProjectId",
      newValue: "",
      updatedBy,
    });
  }

  // Resolve parent by name within the same client.
  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const parentLookup = await resolveProjectOrFail(
    lookup.client.id,
    lookup.client.name,
    parentProjectName,
  );
  if (!parentLookup.ok) return parentLookup;

  return updateProjectField({
    clientSlug,
    projectName,
    field: "parentProjectId",
    newValue: parentLookup.project.id,
    updatedBy,
  });
}
