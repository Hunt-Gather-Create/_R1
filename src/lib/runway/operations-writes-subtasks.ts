/**
 * Runway Write Operations — subtasks
 *
 * Refs _R1#67 phase 1, data and writes only, no UI. A subtask is a
 * week_items row with parentTaskId set. It is not a new table, matching how
 * a sub-project already works as a projects row with parentProjectId set.
 * See docs/plans/subtasks-under-work-items.md for the full design.
 *
 * One level deep only, enforced here, not by convention: a row whose own
 * parentTaskId is already set may never itself be given as a parentTaskId.
 * createSubtask refuses it.
 *
 * A subtask's status is null (todo) or "completed" (done), reusing the
 * existing week_items status vocabulary rather than inventing a second one.
 * Completed subtasks stay visible, struck through, in Phase 2's interface.
 * They are never hidden. See DECISIONS.md.
 *
 * A subtask's due date lives in endDate, the same column L2 work items use
 * for their own due-equivalent date throughout the cascade logic elsewhere
 * in this codebase. startDate, date, weekOf, and dayOfWeek stay null for a
 * subtask row, since subtasks never appear on the weekly board and never
 * participate in its bucketing.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { weekItems } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";
import {
  generateIdempotencyKey,
  generateId,
  checkDuplicate,
  insertAuditRecord,
  validateIsoDateShape,
} from "./operations-utils";
import type { AuditSource } from "./operations-utils";
import type { MutationResponse } from "./mutation-response";

export const SUBTASK_TITLE_MAX_LEN = 280;

/**
 * Refs _R1#141: every weekOf- or sectionId-filtered read site relies on a
 * subtask row never carrying a real value in either column. createSubtask
 * asserts that on the row it is about to insert rather than trusting the
 * column default to produce it by omission, so a future edit to the insert
 * that accidentally threads a weekOf or sectionId through fails loudly here
 * instead of silently opening the three read sites that isolation protects.
 */
export function assertSubtaskShape(row: {
  weekOf: string | null;
  sectionId: string | null;
}): void {
  if (row.weekOf !== null || row.sectionId !== null) {
    throw new Error(
      "createSubtask invariant violated: a subtask row must never carry a weekOf or sectionId."
    );
  }
}

function validateSubtaskTitle(title: string): { ok: true } | { ok: false; error: string } {
  if (!title || title.trim() === "") {
    return { ok: false, error: "Subtask title is required." };
  }
  if (title.length > SUBTASK_TITLE_MAX_LEN) {
    return {
      ok: false,
      error: `Subtask title max length is ${SUBTASK_TITLE_MAX_LEN} characters; got ${title.length}.`,
    };
  }
  return { ok: true };
}

export type SubtaskData = {
  id: string;
  parentTaskId: string;
  title: string;
  owner: string | null;
  status: string | null;
  dueDate: string | null;
  sortOrder: number;
};

// ── Create ────────────────────────────────────────────────

export interface CreateSubtaskParams {
  parentTaskId: string;
  title: string;
  owner?: string | null;
  dueDate?: string | null;
  updatedBy: string;
  source?: AuditSource | null;
}

export async function createSubtask(
  params: CreateSubtaskParams
): Promise<MutationResponse<SubtaskData>> {
  const { parentTaskId, title, owner, dueDate, updatedBy, source } = params;
  const db = getRunwayDb();

  const titleCheck = validateSubtaskTitle(title);
  if (!titleCheck.ok) return titleCheck;

  if (dueDate) {
    const v = validateIsoDateShape(dueDate, "dueDate");
    if (!v.ok) return { ok: false, error: v.error };
  }

  const parentRows = await db.select().from(weekItems).where(eq(weekItems.id, parentTaskId));
  const parent = parentRows[0];
  if (!parent) {
    return { ok: false, error: `Work item '${parentTaskId}' not found.` };
  }
  // One level deep, refs _R1#67. A row whose own parentTaskId is already set
  // is itself a subtask and must be refused as a parent.
  if (parent.parentTaskId) {
    return {
      ok: false,
      error: `'${parent.title}' is itself a subtask and cannot own subtasks. Subtasks are one level deep only.`,
    };
  }

  const idemKey = generateIdempotencyKey("create-subtask", parentTaskId, title, updatedBy);
  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Subtask already created (duplicate request).",
    data: { title },
  });
  if (dup) return dup as MutationResponse<SubtaskData>;

  const subtaskId = generateId();

  // Position at the end of the existing subtask list under this parent.
  const siblingRows = await db
    .select({ sortOrder: weekItems.sortOrder })
    .from(weekItems)
    .where(eq(weekItems.parentTaskId, parentTaskId));
  const nextSortOrder =
    siblingRows.reduce((max, r) => Math.max(max, r.sortOrder ?? 0), -1) + 1;

  const insertValues = {
    id: subtaskId,
    parentTaskId,
    projectId: parent.projectId,
    clientId: parent.clientId,
    title,
    owner: owner ?? null,
    status: null,
    endDate: dueDate ?? null,
    sortOrder: nextSortOrder,
    weekOf: null,
    sectionId: null,
  };
  assertSubtaskShape(insertValues);
  await db.insert(weekItems).values(insertValues);

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: parent.projectId,
    clientId: parent.clientId,
    updatedBy,
    updateType: "create-subtask",
    newValue: title,
    summary: `New subtask under '${parent.title}': ${title}`,
    source: source ?? null,
  });

  return {
    ok: true,
    message: `Created subtask '${title}' under '${parent.title}'.`,
    data: {
      id: subtaskId,
      parentTaskId,
      title,
      owner: owner ?? null,
      status: null,
      dueDate: dueDate ?? null,
      sortOrder: nextSortOrder,
    },
  };
}

// ── Update ────────────────────────────────────────────────

export interface UpdateSubtaskParams {
  id: string;
  title?: string;
  owner?: string | null;
  dueDate?: string | null;
  updatedBy: string;
  source?: AuditSource | null;
}

export async function updateSubtask(
  params: UpdateSubtaskParams
): Promise<MutationResponse<SubtaskData>> {
  const { id, title, owner, dueDate, updatedBy, source } = params;
  const db = getRunwayDb();

  const rows = await db.select().from(weekItems).where(eq(weekItems.id, id));
  const row = rows[0];
  if (!row) return { ok: false, error: `Subtask '${id}' not found.` };
  if (!row.parentTaskId) {
    return {
      ok: false,
      error: `'${row.title}' is a work item, not a subtask. Use the work item update helper instead.`,
    };
  }

  if (title !== undefined) {
    const titleCheck = validateSubtaskTitle(title);
    if (!titleCheck.ok) return titleCheck;
  }
  if (dueDate) {
    const v = validateIsoDateShape(dueDate, "dueDate");
    if (!v.ok) return { ok: false, error: v.error };
  }

  const nextTitle = title ?? row.title;
  const nextOwner = owner !== undefined ? owner : row.owner;
  const nextDueDate = dueDate !== undefined ? dueDate : row.endDate;

  const idemKey = generateIdempotencyKey(
    "update-subtask",
    id,
    nextTitle,
    nextOwner ?? "(null)",
    nextDueDate ?? "(null)",
    updatedBy
  );
  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Subtask update already applied (duplicate request).",
    data: { title: nextTitle },
  });
  if (dup) return dup as MutationResponse<SubtaskData>;

  await db
    .update(weekItems)
    .set({
      title: nextTitle,
      owner: nextOwner ?? null,
      endDate: nextDueDate ?? null,
      updatedAt: new Date(),
    })
    .where(eq(weekItems.id, id));

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: row.projectId,
    clientId: row.clientId,
    updatedBy,
    updateType: "update-subtask",
    previousValue: row.title,
    newValue: nextTitle,
    summary: `Subtask updated: '${row.title}' -> '${nextTitle}'.`,
    source: source ?? null,
  });

  return {
    ok: true,
    message: `Updated subtask '${nextTitle}'.`,
    data: {
      id,
      parentTaskId: row.parentTaskId,
      title: nextTitle,
      owner: nextOwner ?? null,
      status: row.status,
      dueDate: nextDueDate ?? null,
      sortOrder: row.sortOrder,
    },
  };
}

// ── Complete ──────────────────────────────────────────────

export interface CompleteSubtaskParams {
  id: string;
  updatedBy: string;
  source?: AuditSource | null;
}

export async function completeSubtask(
  params: CompleteSubtaskParams
): Promise<MutationResponse<SubtaskData>> {
  const { id, updatedBy, source } = params;
  const db = getRunwayDb();

  const rows = await db.select().from(weekItems).where(eq(weekItems.id, id));
  const row = rows[0];
  if (!row) return { ok: false, error: `Subtask '${id}' not found.` };
  if (!row.parentTaskId) {
    return {
      ok: false,
      error: `'${row.title}' is a work item, not a subtask. Use the work item status helper instead.`,
    };
  }

  const idemKey = generateIdempotencyKey("complete-subtask", id, updatedBy);
  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Subtask already completed (duplicate request).",
    data: { title: row.title },
  });
  if (dup) return dup as MutationResponse<SubtaskData>;

  await db
    .update(weekItems)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(weekItems.id, id));

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: row.projectId,
    clientId: row.clientId,
    updatedBy,
    updateType: "complete-subtask",
    previousValue: row.status,
    newValue: "completed",
    summary: `Subtask completed: '${row.title}'.`,
    source: source ?? null,
  });

  return {
    ok: true,
    message: `Completed subtask '${row.title}'.`,
    data: {
      id,
      parentTaskId: row.parentTaskId,
      title: row.title,
      owner: row.owner,
      status: "completed",
      dueDate: row.endDate,
      sortOrder: row.sortOrder,
    },
  };
}

// ── Delete ────────────────────────────────────────────────

export interface DeleteSubtaskParams {
  id: string;
  updatedBy: string;
  source?: AuditSource | null;
}

export async function deleteSubtask(
  params: DeleteSubtaskParams
): Promise<MutationResponse<{ title: string }>> {
  const { id, updatedBy, source } = params;
  const db = getRunwayDb();

  const rows = await db.select().from(weekItems).where(eq(weekItems.id, id));
  const row = rows[0];
  if (!row) return { ok: false, error: `Subtask '${id}' not found.` };
  if (!row.parentTaskId) {
    return {
      ok: false,
      error: `'${row.title}' is a work item, not a subtask. Use the work item delete helper instead.`,
    };
  }

  const idemKey = generateIdempotencyKey("delete-subtask", id, updatedBy);
  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Subtask already deleted (duplicate request).",
  });
  if (dup) return dup as MutationResponse<{ title: string }>;

  await db.delete(weekItems).where(eq(weekItems.id, id));

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: row.projectId,
    clientId: row.clientId,
    updatedBy,
    updateType: "delete-subtask",
    previousValue: row.title,
    summary: `Deleted subtask: '${row.title}'.`,
    source: source ?? null,
  });

  return {
    ok: true,
    message: `Deleted subtask '${row.title}'.`,
    data: { title: row.title },
  };
}
