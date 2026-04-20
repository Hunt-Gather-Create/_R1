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
} from "./operations-utils";
import type { OperationResult } from "./operations-utils";

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
 * `contract_start` / `contract_end` on the project are NOT touched here —
 * they are read-layer overrides, applied by reads (see v4 convention).
 */
export async function recomputeProjectDates(
  projectId: string | null | undefined
): Promise<{ startDate: string | null; endDate: string | null } | null> {
  if (!projectId) return null;
  const db = getRunwayDb();

  const children = await db
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

  await db
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
    }
  }

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
  await db.insert(weekItems).values({
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
    owner: owner ?? null,
    resources: resources ?? null,
    notes: notes ?? null,
    sortOrder: 999,
  });

  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId,
    updatedBy,
    updateType: "new-week-item",
    newValue: title,
    summary: `New week item${clientName ? ` (${clientName})` : ""}: ${title}`,
  });

  // v4: recompute parent project start/end dates from children.
  if (projectId) {
    await recomputeProjectDates(projectId);
  }

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
): Promise<OperationResult> {
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

  const idemKey = generateIdempotencyKey(
    "week-field-change",
    item.id,
    field,
    newValue,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Update already applied (duplicate request).",
    data: { weekItemTitle: item.title, field, previousValue, newValue },
  });
  if (dup) return dup;

  // Wrap week item update + reverse cascade in a single transaction for atomicity
  let reverseCascaded = false;

  await db.transaction(async (tx) => {
    await tx
      .update(weekItems)
      .set({ [columnKey]: newValue, updatedAt: new Date() })
      .where(eq(weekItems.id, item.id));

    // Reverse cascade: deadline date changes sync back to project.dueDate
    if (typedField === "date" && item.category === "deadline" && item.projectId) {
      await tx
        .update(projects)
        .set({ dueDate: newValue, updatedAt: new Date() })
        .where(eq(projects.id, item.projectId));
      reverseCascaded = true;
    }
  });

  if (reverseCascaded) {
    console.log(JSON.stringify({
      event: "runway_cascade_reverse",
      weekItemId: item.id,
      projectId: item.projectId,
      field: "dueDate",
      newValue,
    }));
  }

  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId: item.clientId,
    updatedBy,
    updateType: "week-field-change",
    previousValue,
    newValue,
    summary: `Week item '${item.title}': ${field} changed from "${previousValue}" to "${newValue}"`,
    metadata: JSON.stringify({ field }),
  });

  // v4: recompute parent project dates when a child date field changes.
  // `date` is the legacy column; `startDate`/`endDate` are the v4 columns.
  if (
    item.projectId &&
    (typedField === "date" || typedField === "startDate" || typedField === "endDate")
  ) {
    await recomputeProjectDates(item.projectId);
  }

  return {
    ok: true,
    message: `Updated ${field} for '${item.title}'.`,
    data: { weekItemTitle: item.title, field, previousValue, newValue, reverseCascaded, clientName },
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

  await db.delete(weekItems).where(eq(weekItems.id, item.id));

  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId: item.clientId,
    updatedBy,
    updateType: "delete-week-item",
    previousValue: item.title,
    summary: `Deleted week item: ${item.title}`,
  });

  // v4: recompute parent project dates after child removal.
  if (parentProjectId) {
    await recomputeProjectDates(parentProjectId);
  }

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

  await db
    .update(weekItems)
    .set({ projectId, updatedAt: new Date() })
    .where(eq(weekItems.id, weekItemId));

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

  // v4: recompute both the previous (if any) and new parent project dates,
  // since the child membership changed on both.
  if (previousProjectId && previousProjectId !== projectId) {
    await recomputeProjectDates(previousProjectId);
  }
  await recomputeProjectDates(projectId);

  return {
    ok: true,
    message: `Linked '${item.title}' to project '${project.name}'.`,
    data: { weekItemTitle: item.title, previousProjectId, newProjectId: projectId, clientName },
  };
}
