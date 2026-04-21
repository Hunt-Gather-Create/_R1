/**
 * Runway Write Operations — week item create, update, and delete
 *
 * Handles creating, updating, and deleting week items
 * with idempotency checks and audit logging.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, weekItems } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";
import {
  WEEK_ITEM_FIELDS,
  WEEK_ITEM_FIELD_TO_COLUMN,
  generateIdempotencyKey,
  generateId,
  getClientOrFail,
  getClientNameById,
  findProjectByFuzzyName,
  resolveWeekItemOrFail,
  checkDuplicate,
  insertAuditRecord,
  validateAndResolveField,
  getPreviousValue,
  normalizeResourcesString,
} from "./operations-utils";
import type { OperationResult } from "./operations-utils";
import type {
  MutationResponse,
  ReverseCascadeInfo,
  UpdateWeekItemFieldData,
} from "./mutation-response";

/**
 * Minimal shape of a Drizzle transaction object we need for the recompute
 * helper. Narrowed to the methods actually used so callers can pass either a
 * top-level `db` or the `tx` handed into `db.transaction(tx => ...)`.
 */
type RecomputeExecutor = Pick<ReturnType<typeof getRunwayDb>, "select" | "update">;

// ── Helpers ──────────────────────────────────────────────

/** Compute the Monday (ISO date) of the week containing the given date. */
function getMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Recompute project.start_date and project.end_date from its non-deleted
 * children's start/end dates (v4 derivation rule).
 *
 * - start_date = MIN(children.start_date)
 * - end_date   = MAX(children.end_date ?? children.start_date)   // single-day → use start
 * - If projectId is null or no children exist, both become null.
 *
 * Skips the `UPDATE projects` entirely when derived values are unchanged to
 * avoid an unnecessary `updated_at` bump and the audit-noise it creates.
 *
 * `contract_start` / `contract_end` on the project are NOT touched here —
 * they are read-layer overrides, applied by reads (see v4 convention).
 *
 * Convenience wrapper around `recomputeProjectDatesWith`. Use the `*With`
 * variant when already inside a `db.transaction(...)` callback so the
 * child write and parent recompute stay atomic (Chunk 5 / Wave 1 debt §2).
 */
export async function recomputeProjectDates(
  projectId: string | null | undefined
): Promise<{ startDate: string | null; endDate: string | null } | null> {
  if (!projectId) return null;
  return recomputeProjectDatesWith(getRunwayDb(), projectId);
}

/**
 * Transaction-aware variant: uses the provided executor (top-level db or a
 * transaction object) for both the read and write. Returns the derived dates
 * for callers that need to thread them into audit metadata.
 */
export async function recomputeProjectDatesWith(
  executor: RecomputeExecutor,
  projectId: string
): Promise<{ startDate: string | null; endDate: string | null }> {
  const children = await executor
    .select({
      startDate: weekItems.startDate,
      endDate: weekItems.endDate,
      date: weekItems.date,
    })
    .from(weekItems)
    .where(eq(weekItems.projectId, projectId));

  let minStart: string | null = null;
  let maxEnd: string | null = null;

  for (const child of children) {
    // Fall back to legacy `date` if startDate missing (pre-backfill rows).
    const start = child.startDate ?? child.date ?? null;
    if (start) {
      if (minStart === null || start < minStart) minStart = start;
    }
    // For end-of-range, prefer explicit end_date, else treat start as single-day.
    const end = child.endDate ?? start;
    if (end) {
      if (maxEnd === null || end > maxEnd) maxEnd = end;
    }
  }

  // No-op skip: only touch the row when derived dates actually changed.
  // Avoids a spurious updated_at bump every time a child is updated without
  // affecting the parent's aggregate range. (Chunk 5 / Wave 1 debt §8.)
  const currentRows = await executor
    .select({ startDate: projects.startDate, endDate: projects.endDate })
    .from(projects)
    .where(eq(projects.id, projectId));
  const current = currentRows[0];
  if (current && current.startDate === minStart && current.endDate === maxEnd) {
    return { startDate: minStart, endDate: maxEnd };
  }

  await executor
    .update(projects)
    .set({ startDate: minStart, endDate: maxEnd, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  return { startDate: minStart, endDate: maxEnd };
}

// ── Create Week Item ─────────────────────────────────────

export interface CreateWeekItemParams {
  clientSlug?: string;
  projectName?: string;
  weekOf?: string;
  dayOfWeek?: string;
  date?: string;
  title: string;
  status?: string;
  category?: string;
  owner?: string;
  resources?: string;
  notes?: string;
  updatedBy: string;
}

export async function createWeekItem(
  params: CreateWeekItemParams
): Promise<OperationResult> {
  const {
    clientSlug,
    projectName,
    weekOf: rawWeekOf,
    dayOfWeek,
    date,
    title,
    status,
    category,
    owner,
    resources,
    notes,
    updatedBy,
  } = params;

  // Auto-calculate weekOf from date if not provided
  const weekOf = rawWeekOf ?? (date ? getMonday(date) : undefined);
  if (!weekOf) {
    return { ok: false, error: "Provide weekOf or date to determine which week this item belongs to." };
  }

  const db = getRunwayDb();

  let clientId: string | null = null;
  let clientName: string | undefined;
  let projectId: string | null = null;

  // v4: when we know the parent L1 we may need its owner for inheritance.
  let resolvedProjectOwner: string | null = null;

  if (clientSlug) {
    const lookup = await getClientOrFail(clientSlug);
    if (!lookup.ok) return lookup;
    clientId = lookup.client.id;
    clientName = lookup.client.name;

    if (projectName) {
      const project = await findProjectByFuzzyName(
        lookup.client.id,
        projectName
      );
      projectId = project?.id ?? null;
      resolvedProjectOwner = project?.owner ?? null;
    }
  }

  // v4 §L2 owner inheritance rule (runway-v4-convention.md):
  // when the caller does not specify an owner, auto-populate from parent
  // L1.owner and store it as an explicit value on the L2. If no parent L1
  // or no L1 owner is known, leave owner null — matches pre-v4 behavior.
  const resolvedOwner = owner ?? resolvedProjectOwner ?? null;

  const idemKey = generateIdempotencyKey(
    "create-week-item",
    clientId ?? "none",
    title,
    weekOf,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Week item already created (duplicate request).",
    data: { clientName, title },
  });
  if (dup) return dup;

  const itemId = generateId();
  // v4 (Chunk 5): normalize resources string on write so storage is
  // canonical (`->` over alt arrows, trimmed entries). `null` preserved.
  const normalizedResources = resources ? normalizeResourcesString(resources) : null;
  // v4 (Chunk 5): wrap child insert + parent-date recompute in a single
  // transaction so a crash between the two cannot leave the parent's
  // derived dates stale.
  await db.transaction(async (tx) => {
    await tx.insert(weekItems).values({
      id: itemId,
      clientId,
      projectId,
      weekOf,
      dayOfWeek: dayOfWeek ?? null,
      date: date ?? null,
      // v4: mirror legacy `date` into `start_date` on create so derivation sees it.
      startDate: date ?? null,
      title,
      status: status ?? null,
      category: category ?? null,
      owner: resolvedOwner,
      resources: normalizedResources,
      notes: notes ?? null,
      sortOrder: 999,
    });
    if (projectId) {
      await recomputeProjectDatesWith(tx, projectId);
    }
  });

  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId,
    updatedBy,
    updateType: "new-week-item",
    newValue: title,
    summary: `New week item${clientName ? ` (${clientName})` : ""}: ${title}`,
  });

  return {
    ok: true,
    message: `Added '${title}' to week of ${weekOf}.`,
    data: { clientName, title },
  };
}

// ── Update Week Item Field ───────────────────────────────

export interface UpdateWeekItemFieldParams {
  weekOf: string;
  weekItemTitle: string;
  field: string;
  newValue: string;
  updatedBy: string;
}

export async function updateWeekItemField(
  params: UpdateWeekItemFieldParams
): Promise<MutationResponse<UpdateWeekItemFieldData>> {
  const { weekOf, weekItemTitle, field, newValue, updatedBy } = params;
  const db = getRunwayDb();

  const fieldResult = validateAndResolveField(field, WEEK_ITEM_FIELDS, WEEK_ITEM_FIELD_TO_COLUMN);
  if (!fieldResult.ok) return fieldResult;
  const { typedField, columnKey } = fieldResult;

  const itemLookup = await resolveWeekItemOrFail(weekOf, weekItemTitle);
  if (!itemLookup.ok) return itemLookup;
  const item = itemLookup.item;

  const clientName = await getClientNameById(item.clientId);

  const previousValue = getPreviousValue(item, columnKey);

  // v4 (Chunk 5): normalize resources on write so storage stays canonical.
  const effectiveNewValue =
    typedField === "resources" ? normalizeResourcesString(newValue) : newValue;

  const idemKey = generateIdempotencyKey(
    "week-field-change",
    item.id,
    field,
    effectiveNewValue,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Update already applied (duplicate request).",
    data: {
      weekItemTitle: item.title,
      field,
      previousValue,
      newValue: effectiveNewValue,
      reverseCascaded: false,
      reverseCascadeDetail: null,
      clientName,
    },
  });
  if (dup) return dup as MutationResponse<UpdateWeekItemFieldData>;

  // Determine whether this write will reverse-cascade; if so, snapshot the
  // parent project BEFORE the transaction so we can surface the prior
  // `dueDate` + name in the structured response (PR #86). We still set the
  // actual cascade flag inside the transaction.
  const willReverseCascade =
    typedField === "date" && item.category === "deadline" && !!item.projectId;
  let parentSnapshot: { id: string; name: string; dueDate: string | null } | null =
    null;
  if (willReverseCascade && item.projectId) {
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, item.projectId));
    const row = rows[0];
    if (row) {
      parentSnapshot = {
        id: row.id,
        name: row.name,
        dueDate: row.dueDate ?? null,
      };
    }
  }

  // Wrap week item update + reverse cascade + parent-date recompute in a
  // single transaction so the three writes commit (or roll back) atomically.
  let reverseCascaded = false;

  await db.transaction(async (tx) => {
    await tx
      .update(weekItems)
      .set({ [columnKey]: effectiveNewValue, updatedAt: new Date() })
      .where(eq(weekItems.id, item.id));

    // Reverse cascade: deadline date changes sync back to project.dueDate
    if (typedField === "date" && item.category === "deadline" && item.projectId) {
      await tx
        .update(projects)
        .set({ dueDate: effectiveNewValue, updatedAt: new Date() })
        .where(eq(projects.id, item.projectId));
      reverseCascaded = true;
    }

    // v4: recompute parent project dates when a child date field changes.
    // `date` is the legacy column; `startDate`/`endDate` are the v4 columns.
    if (
      item.projectId &&
      (typedField === "date" || typedField === "startDate" || typedField === "endDate")
    ) {
      await recomputeProjectDatesWith(tx, item.projectId);
    }
  });

  if (reverseCascaded) {
    console.log(JSON.stringify({
      event: "runway_cascade_reverse",
      weekItemId: item.id,
      projectId: item.projectId,
      field: "dueDate",
      newValue: effectiveNewValue,
    }));
  }

  const auditId = await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId: item.clientId,
    updatedBy,
    updateType: "week-field-change",
    previousValue,
    newValue: effectiveNewValue,
    summary: `Week item '${item.title}': ${field} changed from "${previousValue}" to "${effectiveNewValue}"`,
    metadata: JSON.stringify({ field }),
  });

  // Populate reverseCascadeDetail only when the cascade fired AND we
  // successfully snapshotted the parent. A missing snapshot would leave the
  // detail incomplete, so we degrade to null rather than invent values.
  const reverseCascadeDetail: ReverseCascadeInfo | null =
    reverseCascaded && parentSnapshot
      ? {
          projectId: parentSnapshot.id,
          projectName: parentSnapshot.name,
          field: "dueDate",
          previousDueDate: parentSnapshot.dueDate,
          newDueDate: effectiveNewValue,
          auditId,
        }
      : null;

  return {
    ok: true,
    message: `Updated ${field} for '${item.title}'.`,
    data: {
      weekItemTitle: item.title,
      field,
      previousValue,
      newValue: effectiveNewValue,
      reverseCascaded,
      reverseCascadeDetail,
      clientName,
      auditId,
    },
  };
}

// ── Delete Week Item ────────────────────────────────────

export interface DeleteWeekItemParams {
  /** Provide either weekOf + weekItemTitle (fuzzy match) or id (direct lookup) */
  weekOf?: string;
  weekItemTitle?: string;
  id?: string;
  updatedBy: string;
}

export async function deleteWeekItem(
  params: DeleteWeekItemParams
): Promise<OperationResult> {
  const { weekOf, weekItemTitle, id, updatedBy } = params;
  const db = getRunwayDb();

  let item: typeof weekItems.$inferSelect | undefined;

  if (id) {
    const rows = await db
      .select()
      .from(weekItems)
      .where(eq(weekItems.id, id));
    item = rows[0];
    if (!item) {
      return { ok: false, error: `Week item with id '${id}' not found.` };
    }
  } else if (weekOf && weekItemTitle) {
    const itemLookup = await resolveWeekItemOrFail(weekOf, weekItemTitle);
    if (!itemLookup.ok) return itemLookup;
    item = itemLookup.item;
  } else {
    return { ok: false, error: "Provide either id or weekOf + weekItemTitle to identify the week item." };
  }

  const idemKey = generateIdempotencyKey(
    "delete-week-item",
    item.id,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Week item already deleted (duplicate request).",
  });
  if (dup) return dup;

  const clientName = await getClientNameById(item.clientId);
  const parentProjectId = item.projectId;

  // v4 (Chunk 5): atomic delete + parent-date recompute.
  await db.transaction(async (tx) => {
    await tx.delete(weekItems).where(eq(weekItems.id, item.id));
    if (parentProjectId) {
      await recomputeProjectDatesWith(tx, parentProjectId);
    }
  });

  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId: item.clientId,
    updatedBy,
    updateType: "delete-week-item",
    previousValue: item.title,
    summary: `Deleted week item: ${item.title}`,
  });

  return {
    ok: true,
    message: `Deleted week item '${item.title}'.`,
    data: { clientName },
  };
}

// ── Link Week Item To Project ───────────────────────────

export interface LinkWeekItemToProjectParams {
  weekItemId: string;
  projectId: string;
  updatedBy: string;
}

export async function linkWeekItemToProject(
  params: LinkWeekItemToProjectParams
): Promise<OperationResult> {
  const { weekItemId, projectId, updatedBy } = params;
  const db = getRunwayDb();

  const itemRows = await db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, weekItemId));
  const item = itemRows[0];
  if (!item) {
    return { ok: false, error: `Week item '${weekItemId}' not found.` };
  }

  const projectRows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  const project = projectRows[0];
  if (!project) {
    return { ok: false, error: `Project '${projectId}' not found.` };
  }

  if (item.clientId !== project.clientId) {
    return {
      ok: false,
      error: `Week item '${item.title}' (client ${item.clientId ?? "none"}) cannot be linked to project '${project.name}' (client ${project.clientId}) — client mismatch.`,
    };
  }

  const previousProjectId = item.projectId;
  const clientName = await getClientNameById(item.clientId);

  const idemKey = generateIdempotencyKey(
    "link-week-item",
    weekItemId,
    projectId,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Link already applied (duplicate request).",
    data: { weekItemTitle: item.title, previousProjectId, newProjectId: projectId, clientName },
  });
  if (dup) return dup;

  // v4 (Chunk 5): reparent + recompute both parents atomically. A crash
  // between the three writes could leave one or both parents with stale
  // derived dates; the transaction closes that window.
  await db.transaction(async (tx) => {
    await tx
      .update(weekItems)
      .set({ projectId, updatedAt: new Date() })
      .where(eq(weekItems.id, weekItemId));

    if (previousProjectId && previousProjectId !== projectId) {
      await recomputeProjectDatesWith(tx, previousProjectId);
    }
    await recomputeProjectDatesWith(tx, projectId);
  });

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId,
    clientId: item.clientId,
    updatedBy,
    updateType: "week-reparent",
    previousValue: previousProjectId ?? "(none)",
    newValue: projectId,
    summary: `Week item '${item.title}': re-parented from ${previousProjectId ?? "(none)"} to ${project.name}`,
  });

  return {
    ok: true,
    message: `Linked '${item.title}' to project '${project.name}'.`,
    data: { weekItemTitle: item.title, previousProjectId, newProjectId: projectId, clientName },
  };
}
