/**
 * Runway Write Operations — L3 sections (4-level hierarchy, 2026-07-26)
 *
 * Invariants enforced here (v4-schema-plan §4.2):
 *  1. weekItem.sectionId != null implies weekItem.projectId == section.projectId.
 *     Reparent rewrites both atomically inside one transaction.
 *  2. Deleting a section demotes its children (sectionId → NULL) in the same
 *     transaction. Section deletion never deletes tasks.
 *  3. Canceled section (status='canceled') is a STATUS FLIP, not a delete.
 *     Children stay attached; the audit row carries an openChildCount so the
 *     digest can prompt "cancel them / move them / leave them".
 *
 * D7 sync-respect rule: the sheet-sync engine's only write surface for
 * sections is `reconcileSectionFromSheet`, whose signature structurally
 * cannot touch the 5 actionable fields (SECTION_ACTIONABLE_FIELDS). An
 * operator-promoted section survives every reconcile run.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, sections, weekItems } from "@/lib/db/runway-schema";
import { and, eq, inArray, isNull, not, or } from "drizzle-orm";
import {
  SECTION_FIELDS,
  SECTION_FIELD_TO_COLUMN,
  generateId,
  generateIdempotencyKey,
  checkDuplicate,
  insertAuditRecord,
  validateAndResolveField,
  getPreviousValue,
  normalizeResourcesString,
  validateIsoDateShape,
  validateWeekItemStatus,
  validateRoleTagOnResources,
  validateStartEndDateOrder,
  validateNotesMaxLength,
} from "./operations-utils";
import type { AuditSource } from "./operations-utils";
import type { MutationResponse } from "./mutation-response";
import { getSectionById } from "./operations-reads-sections";
import { getSheetSyncLedger } from "./sheet-sync-ledger-repo";

/** L4 statuses that count as "open" for the canceled-section digest prompt. */
const OPEN_TASK_STATUSES_EXCLUDED = ["completed", "canceled"] as const;

// ── Shared field validation ──────────────────────────────

/**
 * Validate one section field value. Status REUSES the L4 week-item enum
 * (plan guardrail: no third status vocabulary). Dates are strict ISO.
 * Returns the normalized value to store.
 */
function validateSectionFieldValue(
  field: string,
  value: string | null,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  switch (field) {
    case "status": {
      const v = validateWeekItemStatus(value);
      if (!v.ok) return v;
      return { ok: true, value: v.value };
    }
    case "startDate":
    case "endDate": {
      const v = validateIsoDateShape(value, field);
      if (!v.ok) return v;
      return { ok: true, value: v.value };
    }
    case "resources": {
      const r = validateRoleTagOnResources(value);
      if (!r.ok) return r;
      return { ok: true, value: normalizeResourcesString(value) };
    }
    case "notes": {
      const n = validateNotesMaxLength(value, "L3");
      if (!n.ok) return n;
      return { ok: true, value };
    }
    default:
      return { ok: true, value };
  }
}

// ── Create Section ───────────────────────────────────────

export interface CreateSectionParams {
  projectId: string;
  title: string;
  sortOrder?: number;
  notes?: string | null;
  /** Actionable-optional fields (plan §4.1). Omit all for pure grouping. */
  status?: string | null;
  owner?: string | null;
  resources?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  updatedBy: string;
  source?: AuditSource;
}

export async function createSection(
  params: CreateSectionParams,
): Promise<MutationResponse<{ sectionId: string; title: string }>> {
  const {
    projectId, title, sortOrder, notes, status, owner, resources,
    startDate, endDate, updatedBy, source,
  } = params;
  const db = getRunwayDb();

  if (!title.trim()) return { ok: false, error: "Section title cannot be empty." };

  const projectRows = await db
    .select({ id: projects.id, name: projects.name, clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const project = projectRows[0];
  if (!project) return { ok: false, error: `Project '${projectId}' not found.` };

  const actionable: Record<string, string | null> = {};
  for (const [field, value] of Object.entries({ status, owner, resources, startDate, endDate, notes })) {
    if (value === undefined) continue;
    const v = validateSectionFieldValue(field, value);
    if (!v.ok) return { ok: false, error: v.error };
    actionable[field] = v.value;
  }
  const sed = validateStartEndDateOrder(
    (actionable.startDate as string | undefined) ?? null,
    (actionable.endDate as string | undefined) ?? null,
  );
  if (!sed.ok) return { ok: false, error: sed.error };

  // Duplicate guard is a LIVE-ROW check, not an updates-table idempotency
  // key: a retry returns the real existing section's id (safe to chain
  // into create_week_item), and deleting a section never permanently
  // blocks recreating one with the same title. The audit idempotency key
  // is salted with the fresh sectionId so recreation audits cleanly.
  const existingRows = await db
    .select({ id: sections.id, title: sections.title })
    .from(sections)
    .where(eq(sections.projectId, projectId));
  const existing = existingRows.find(
    (s) => s.title.toLowerCase() === title.trim().toLowerCase(),
  );
  if (existing) {
    return {
      ok: true,
      message: `Section '${existing.title}' already exists under ${project.name} (duplicate request).`,
      data: { sectionId: existing.id, title: existing.title },
    };
  }

  const sectionId = generateId();
  const idemKey = generateIdempotencyKey("create-section", projectId, title, sectionId);

  await db.insert(sections).values({
    id: sectionId,
    projectId,
    title,
    sortOrder: sortOrder ?? 0,
    notes: (actionable.notes as string | null) ?? null,
    status: (actionable.status as string | null) ?? null,
    owner: (actionable.owner as string | null) ?? null,
    resources: (actionable.resources as string | null) ?? null,
    startDate: (actionable.startDate as string | null) ?? null,
    endDate: (actionable.endDate as string | null) ?? null,
  });

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId,
    clientId: project.clientId,
    updatedBy,
    updateType: "new-section",
    newValue: title,
    summary: `New section under ${project.name}: ${title}`,
    metadata: JSON.stringify({ sectionId }),
    source: source ?? null,
  });

  return { ok: true, message: `Added section '${title}' to ${project.name}.`, data: { sectionId, title } };
}

// ── Update Section Field ─────────────────────────────────

export interface UpdateSectionFieldParams {
  sectionId: string;
  field: string;
  newValue: string | null;
  updatedBy: string;
  source?: AuditSource;
}

/**
 * Single-field section update. Setting any of the 5 actionable fields IS the
 * "promote to actionable" flow — no dedicated promote verb. Status is never
 * auto-derived from children and never auto-flips them, in either direction.
 *
 * status='canceled' is invariant 3: a flip, not a delete. The audit row's
 * metadata carries `openChildCount` so the end-of-session digest can prompt
 * for child-task handling when open tasks remain attached.
 */
export async function updateSectionField(
  params: UpdateSectionFieldParams,
): Promise<
  MutationResponse<{
    sectionTitle: string;
    field: string;
    previousValue: string | null;
    newValue: string | null;
    openChildCount?: number;
  }>
> {
  const { sectionId, field, newValue, updatedBy, source } = params;
  const db = getRunwayDb();

  const fieldResult = validateAndResolveField(field, SECTION_FIELDS, SECTION_FIELD_TO_COLUMN);
  if (!fieldResult.ok) return fieldResult;
  const { columnKey } = fieldResult;

  const section = await getSectionById(sectionId);
  if (!section) return { ok: false, error: `Section '${sectionId}' not found.` };

  // sortOrder arrives as a string through the generic field path; coerce.
  let storedValue: string | number | null;
  if (field === "sortOrder") {
    if (newValue === null || newValue === "") {
      storedValue = 0;
    } else if (!/^-?\d+$/.test(newValue)) {
      return { ok: false, error: `sortOrder must be an integer; got '${newValue}'.` };
    } else {
      storedValue = Number(newValue);
    }
  } else {
    const v = validateSectionFieldValue(field, newValue === "" ? null : newValue);
    if (!v.ok) return { ok: false, error: v.error };
    storedValue = v.value;
    // Date-order check against the OTHER side already on the row.
    if (field === "startDate") {
      const sed = validateStartEndDateOrder(v.value, section.endDate ?? null);
      if (!sed.ok) return { ok: false, error: sed.error };
    }
    if (field === "endDate") {
      const sed = validateStartEndDateOrder(section.startDate ?? null, v.value);
      if (!sed.ok) return { ok: false, error: sed.error };
    }
    if (field === "title" && (v.value === null || !v.value.trim())) {
      return { ok: false, error: "Section title cannot be empty." };
    }
  }

  const previousValue = getPreviousValue(section, columnKey);
  const idemNewValue = storedValue === null ? "(null)" : String(storedValue);
  const idemKey = generateIdempotencyKey(
    "section-field-change", sectionId, field, idemNewValue, updatedBy,
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Update already applied (duplicate request).",
    data: { sectionTitle: section.title, field, previousValue, newValue: idemNewValue === "(null)" ? null : idemNewValue },
  });
  if (dup)
    return dup as MutationResponse<{
      sectionTitle: string;
      field: string;
      previousValue: string | null;
      newValue: string | null;
      openChildCount?: number;
    }>;

  // Invariant 3: canceled is a status flip — count open children so the
  // digest can surface "N open tasks under canceled section".
  let openChildCount: number | undefined;
  if (field === "status" && storedValue === "canceled") {
    // NULL status = scheduled = open — `status NOT IN (...)` alone would
    // silently drop NULL rows (SQL three-valued logic), undercounting.
    const openChildren = await db
      .select({ id: weekItems.id })
      .from(weekItems)
      .where(
        and(
          eq(weekItems.sectionId, sectionId),
          or(
            isNull(weekItems.status),
            not(inArray(weekItems.status, [...OPEN_TASK_STATUSES_EXCLUDED])),
          ),
        ),
      );
    openChildCount = openChildren.length;
  }

  await db
    .update(sections)
    .set({ [columnKey]: storedValue, updatedAt: new Date() })
    .where(eq(sections.id, sectionId));

  const clientId = await lookupClientIdForProject(section.projectId);
  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: section.projectId,
    clientId,
    updatedBy,
    updateType: "section-field-change",
    previousValue,
    newValue: storedValue === null ? null : String(storedValue),
    summary: `Section '${section.title}': ${field} changed from "${previousValue ?? "(null)"}" to "${idemNewValue}"`,
    metadata: JSON.stringify(
      openChildCount !== undefined
        ? { field, sectionId, openChildCount }
        : { field, sectionId },
    ),
    source: source ?? null,
  });

  return {
    ok: true,
    message:
      openChildCount !== undefined && openChildCount > 0
        ? `Marked section '${section.title}' canceled. ${openChildCount} open task(s) remain attached — cancel them, move them, or leave them.`
        : `Updated ${field} for section '${section.title}'.`,
    data: {
      sectionTitle: section.title,
      field,
      previousValue,
      newValue: storedValue === null ? null : String(storedValue),
      ...(openChildCount !== undefined ? { openChildCount } : {}),
    },
  };
}

// ── Delete Section ───────────────────────────────────────

export interface DeleteSectionParams {
  sectionId: string;
  updatedBy: string;
  source?: AuditSource;
}

/**
 * Invariant 2: deleting a section demotes its children to loose tasks
 * (sectionId → NULL) inside the same transaction — never deletes them.
 * If the section has a sync-ledger row, it flips to state='wi-deleted' in
 * the same transaction so the next reconcile surfaces the orphaned sheet row
 * instead of re-importing a duplicate section.
 */
export async function deleteSection(
  params: DeleteSectionParams,
): Promise<MutationResponse<{ sectionTitle: string; demotedCount: number }>> {
  const { sectionId, updatedBy, source } = params;
  const db = getRunwayDb();

  const section = await getSectionById(sectionId);
  if (!section) return { ok: false, error: `Section '${sectionId}' not found.` };

  const idemKey = generateIdempotencyKey("delete-section", sectionId, updatedBy);
  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Section already deleted (duplicate request).",
    data: { sectionTitle: section.title, demotedCount: 0 },
  });
  if (dup) return dup as MutationResponse<{ sectionTitle: string; demotedCount: number }>;

  // Count + demote + delete all inside one transaction — a task attached
  // between a pre-tx count and the tx would otherwise dangle a sectionId
  // pointing at a deleted section (invariant 2 under a race).
  let demotedCount = 0;
  await db.transaction(async (tx) => {
    const children = await tx
      .select({ id: weekItems.id })
      .from(weekItems)
      .where(eq(weekItems.sectionId, sectionId));
    demotedCount = children.length;
    await tx
      .update(weekItems)
      .set({ sectionId: null, updatedAt: new Date() })
      .where(eq(weekItems.sectionId, sectionId));
    await tx.delete(sections).where(eq(sections.id, sectionId));
    await getSheetSyncLedger(tx).markStateByRunwayId(sectionId, "wi-deleted");
  });

  const clientId = await lookupClientIdForProject(section.projectId);
  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: section.projectId,
    clientId,
    updatedBy,
    updateType: "delete-section",
    previousValue: section.title,
    summary: `Deleted section '${section.title}' (${demotedCount} task(s) demoted to loose).`,
    metadata: JSON.stringify({ sectionId, demotedCount }),
    source: source ?? null,
  });

  return {
    ok: true,
    message: `Deleted section '${section.title}'. ${demotedCount} task(s) kept as loose tasks.`,
    data: { sectionTitle: section.title, demotedCount },
  };
}

// ── Reparent Week Item To Section ────────────────────────

export interface ReparentWeekItemToSectionParams {
  weekItemId: string;
  /** Target section id, or null to demote to a loose task (keeps projectId). */
  sectionId: string | null;
  updatedBy: string;
  source?: AuditSource;
}

/**
 * Invariant 1: sectionId and projectId move together atomically. Assigning a
 * section rewrites the task's projectId to the section's projectId (and its
 * clientId to the project's clientId) in one transaction, so a task can never
 * point at a section belonging to a different project.
 */
export async function reparentWeekItemToSection(
  params: ReparentWeekItemToSectionParams,
): Promise<
  MutationResponse<{
    weekItemTitle: string;
    previousSectionId: string | null;
    newSectionId: string | null;
  }>
> {
  const { weekItemId, sectionId, updatedBy, source } = params;
  const db = getRunwayDb();

  const itemRows = await db
    .select()
    .from(weekItems)
    .where(eq(weekItems.id, weekItemId))
    .limit(1);
  const item = itemRows[0];
  if (!item) return { ok: false, error: `Week item '${weekItemId}' not found.` };
  // Refs _R1#67: a subtask never carries its own sectionId, several other
  // read sites rely on that being true unconditionally. Refuse rather than
  // silently let one acquire a sectionId here.
  if (item.parentTaskId) {
    return {
      ok: false,
      error: `'${item.title}' is a subtask, not a work item. Subtasks do not belong to sections.`,
    };
  }

  let targetSection: Awaited<ReturnType<typeof getSectionById>> = null;
  let targetClientId: string | null = null;
  if (sectionId !== null) {
    targetSection = await getSectionById(sectionId);
    if (!targetSection) return { ok: false, error: `Section '${sectionId}' not found.` };
    const projectRows = await db
      .select({ clientId: projects.clientId })
      .from(projects)
      .where(eq(projects.id, targetSection.projectId))
      .limit(1);
    targetClientId = projectRows[0]?.clientId ?? null;
  }

  const previousSectionId = item.sectionId ?? null;
  const idemKey = generateIdempotencyKey(
    "section-reparent", weekItemId, sectionId ?? "(none)", updatedBy,
  );
  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Reparent already applied (duplicate request).",
    data: { weekItemTitle: item.title, previousSectionId, newSectionId: sectionId },
  });
  if (dup)
    return dup as MutationResponse<{
      weekItemTitle: string;
      previousSectionId: string | null;
      newSectionId: string | null;
    }>;

  // A taskNo is sheet-placement identity: it belongs to the (engagement,
  // section) the sheet assigned it in. Moving the task out of that section
  // clears the number and flags the task's ledger row so the next reconcile
  // surfaces the displaced sheet row for operator resolution — instead of
  // the sheet mapping "3.2" onto a task that now lives somewhere else.
  const sectionChanging = previousSectionId !== sectionId;
  const clearTaskNo = sectionChanging && item.taskNo !== null;

  await db.transaction(async (tx) => {
    if (sectionId === null) {
      // Demote to loose task; project link unchanged.
      await tx
        .update(weekItems)
        .set({
          sectionId: null,
          ...(clearTaskNo ? { taskNo: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(weekItems.id, weekItemId));
    } else {
      // Invariant 1: rewrite section + project (+ client) together.
      await tx
        .update(weekItems)
        .set({
          sectionId,
          projectId: targetSection!.projectId,
          clientId: targetClientId ?? item.clientId,
          ...(clearTaskNo ? { taskNo: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(weekItems.id, weekItemId));
    }
    if (sectionChanging) {
      const ledger = getSheetSyncLedger(tx);
      const entry = await ledger.findByRunwayId(weekItemId);
      if (entry) await ledger.markStateByRunwayId(weekItemId, "flagged");
    }
  });

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: targetSection?.projectId ?? item.projectId,
    clientId: targetClientId ?? item.clientId,
    updatedBy,
    updateType: "section-reparent",
    previousValue: previousSectionId ?? "(none)",
    newValue: sectionId ?? "(none)",
    summary: `Week item '${item.title}': section ${previousSectionId ?? "(none)"} -> ${
      targetSection ? `'${targetSection.title}'` : "(none)"
    }`,
    metadata: JSON.stringify({ weekItemId, previousSectionId, newSectionId: sectionId }),
    source: source ?? null,
  });

  return {
    ok: true,
    message: sectionId
      ? `Moved '${item.title}' into section '${targetSection!.title}'.`
      : `Detached '${item.title}' from its section.`,
    data: { weekItemTitle: item.title, previousSectionId, newSectionId: sectionId },
  };
}

// ── Sheet-sync reconcile surface (D7) ────────────────────

export interface ReconcileSectionFromSheetParams {
  sectionId: string;
  /** The ONLY fields sync may write. Actionable fields are structurally absent. */
  title?: string;
  sortOrder?: number;
  /** Sync run provenance, e.g. "sheet-sync:<runId>". Recorded in the audit row. */
  syncRunId: string;
  updatedBy: string;
}

/**
 * D7 sync-respect rule: this is the sheet-sync engine's ONLY write surface
 * for sections. The parameter shape cannot express the 5 actionable fields
 * (SECTION_ACTIONABLE_FIELDS), so an operator-promoted section survives
 * every reconcile untouched. Engine consumption lands with Phase 1b (G5);
 * shipping the surface now locks the boundary before any engine exists.
 */
export async function reconcileSectionFromSheet(
  params: ReconcileSectionFromSheetParams,
): Promise<MutationResponse<{ sectionTitle: string }>> {
  const { sectionId, title, sortOrder, syncRunId, updatedBy } = params;
  const db = getRunwayDb();

  const section = await getSectionById(sectionId);
  if (!section) return { ok: false, error: `Section '${sectionId}' not found.` };

  const patch: Partial<{ title: string; sortOrder: number; updatedAt: Date }> = {};
  if (title !== undefined && title !== section.title) {
    if (!title.trim()) return { ok: false, error: "Section title cannot be empty." };
    patch.title = title;
  }
  if (sortOrder !== undefined && sortOrder !== section.sortOrder) {
    patch.sortOrder = sortOrder;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true, message: "Section already in sync.", data: { sectionTitle: section.title } };
  }

  const idemKey = generateIdempotencyKey(
    "section-reconcile", sectionId, syncRunId, JSON.stringify(patch),
  );
  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Reconcile already applied (duplicate request).",
    data: { sectionTitle: patch.title ?? section.title },
  });
  if (dup) return dup as MutationResponse<{ sectionTitle: string }>;

  patch.updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(sections).set(patch).where(eq(sections.id, sectionId));
    // Keep the section's ledger row provenance current with this pass.
    await getSheetSyncLedger(tx).touchByRunwayId(sectionId, {
      lastSeenTitle: patch.title ?? section.title,
      lastSyncRunId: syncRunId,
    });
  });

  const clientId = await lookupClientIdForProject(section.projectId);
  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: section.projectId,
    clientId,
    updatedBy,
    updateType: "section-field-change",
    previousValue: section.title,
    newValue: patch.title ?? section.title,
    summary: `Section '${section.title}' reconciled from sheet (${Object.keys(patch)
      .filter((k) => k !== "updatedAt")
      .join(", ")}).`,
    metadata: JSON.stringify({ sectionId, syncRunId }),
    source: null,
  });

  return {
    ok: true,
    message: `Reconciled section '${patch.title ?? section.title}'.`,
    data: { sectionTitle: patch.title ?? section.title },
  };
}

// ── Internal ─────────────────────────────────────────────

async function lookupClientIdForProject(projectId: string): Promise<string | null> {
  const db = getRunwayDb();
  const rows = await db
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return rows[0]?.clientId ?? null;
}
