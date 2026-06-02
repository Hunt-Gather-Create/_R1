/**
 * Runway Write Operations — week item create, update, and delete
 *
 * Handles creating, updating, and deleting week items
 * with idempotency checks and audit logging.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, updates, weekItems } from "@/lib/db/runway-schema";
import { and, eq, sql } from "drizzle-orm";
import { getCurrentBatchId } from "./runway-als";
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
  validateIsoDateShape,
  validateWeekItemStatus,
  validateWeekItemCategory,
  validateStatusCategoryCompatibility,
  validateRoleTagOnResources,
  validateStartEndDateOrder,
  validateNotesMaxLength,
} from "./operations-utils";
import type {
  AuditEvent,
  AuditSource,
} from "./operations-utils";

/**
 * Optional context the cascade audit row needs when `recomputeProjectDatesWith`
 * actually moves project dates. Tests that exercise raw derivation may omit
 * this — production callers always thread it through so the cascade leaves
 * an audit trail. See `cascade-date-change` emit at the bottom of the function.
 */
export interface RecomputeAuditContext {
  updatedBy: string;
  source?: AuditSource | null;
  /**
   * When the trigger that called recompute already wrote an audit row (e.g.
   * the L2 field-change row in updateWeekItemField), pass that audit id so
   * the cascade row links back via `triggered_by_update_id`. Mirrors the
   * cascade-status / cascade-duedate pattern.
   */
  triggeredByUpdateId?: string | null;
}
import type {
  MutationResponse,
  ReverseCascadeInfo,
  UpdateWeekItemFieldData,
} from "./mutation-response";

/**
 * Minimal shape of a Drizzle transaction object we need for the recompute
 * helper. Narrowed to the methods actually used so callers can pass either a
 * top-level `db` or the `tx` handed into `db.transaction(tx => ...)`. Includes
 * `insert` so the cascade-date-change audit row (#19) can be written via the
 * same executor when an `auditContext` is supplied.
 */
type RecomputeExecutor = Pick<ReturnType<typeof getRunwayDb>, "select" | "update" | "insert">;

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
  projectId: string | null | undefined,
  auditContext?: RecomputeAuditContext,
): Promise<{ startDate: string | null; endDate: string | null } | null> {
  if (!projectId) return null;
  return recomputeProjectDatesWith(getRunwayDb(), projectId, auditContext);
}

/**
 * Transaction-aware variant: uses the provided executor (top-level db or a
 * transaction object) for both the read and write. Returns the derived dates
 * for callers that need to thread them into audit metadata.
 *
 * When `auditContext` is provided and the recompute actually writes new
 * dates (not a no-op + not fully override-preserved), emits a
 * `cascade-date-change` audit row per field that moved. Issue #19: prior to
 * this, parent recompute wrote dates with no audit trail, leaving cohorts
 * under-counting audit rows by 1+ per cascade boundary.
 *
 * Per-batch double-write guard: when `overrideProjectDate` already pinned a
 * field via `date-override` audit row earlier in this batch, the override
 * logic below forces `effective[field] = current[field]`, so the per-field
 * "did this actually change?" gate naturally suppresses the cascade row for
 * the override-protected field. No additional guard needed.
 */
export async function recomputeProjectDatesWith(
  executor: RecomputeExecutor,
  projectId: string,
  auditContext?: RecomputeAuditContext,
): Promise<{ startDate: string | null; endDate: string | null }> {
  // Retainer-wrapper guard: a retainer L1 with at least one child — L1 OR L2
  // — acts as a SOW-window wrapper. Its start_date / end_date are pinned to
  // the contract dates the operator set, NOT recomputed from child widths.
  // Children L1s under it still recompute normally because they're visited
  // with their own projectId by L2 writes on those children.
  //
  // Issue #8: pre-fix, the guard only counted L1 children. A retainer with
  // only L2 children (BP Email Templates pattern) fell through to L2-derived
  // recompute and silently collapsed the SOW envelope to whatever L2 window
  // was current. Migrations had to paper over this with paired
  // `overrideProjectDate` calls after every L2 insert. Counting L2 children
  // here removes that workaround.
  const projectRows = await executor
    .select({
      engagementType: projects.engagementType,
      startDate: projects.startDate,
      endDate: projects.endDate,
      clientId: projects.clientId,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  const project = projectRows[0];
  if (project?.engagementType === "retainer") {
    const childProjects = await executor
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.parentProjectId, projectId));
    if (childProjects.length > 0) {
      return { startDate: project.startDate, endDate: project.endDate };
    }
    const childWeekItems = await executor
      .select({ id: weekItems.id })
      .from(weekItems)
      .where(eq(weekItems.projectId, projectId));
    if (childWeekItems.length > 0) {
      return { startDate: project.startDate, endDate: project.endDate };
    }
    // Truly empty retainer (no L1 + no L2 children): fall through to the
    // shared recompute path below. With no children to derive from, that
    // path writes {null, null}. In practice a fully-childless retainer is
    // a migration bootstrap edge case, not a steady state.
  }

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

  // Issue #16: in-batch override guard. If `overrideProjectDate` ran on this
  // project earlier in the same batch (AsyncLocalStorage scope) and pinned
  // start_date or end_date, do not let the child-derived MIN/MAX clobber it.
  // Per-field granularity — an override on startDate does not protect endDate.
  // Outside a batch, the guard is a no-op and the existing clobber stays
  // (cross-batch overrides are intentionally not pinned — see plan §3).
  const currentBatchId = getCurrentBatchId();
  let effectiveStart: string | null = minStart;
  let effectiveEnd: string | null = maxEnd;
  if (currentBatchId && current) {
    const overriddenRows = await executor
      .select({
        field: sql<string | null>`json_extract(${updates.metadata}, '$.field')`,
      })
      .from(updates)
      .where(
        and(
          eq(updates.projectId, projectId),
          eq(updates.updateType, "date-override"),
          eq(updates.batchId, currentBatchId),
        ),
      );
    const overridden = new Set<string>();
    for (const row of overriddenRows) {
      if (row.field === "startDate" || row.field === "endDate") {
        overridden.add(row.field);
      }
    }
    if (overridden.has("startDate")) effectiveStart = current.startDate;
    if (overridden.has("endDate")) effectiveEnd = current.endDate;
    if (
      effectiveStart === current.startDate &&
      effectiveEnd === current.endDate
    ) {
      // Both fields preserved by overrides — nothing to write.
      return { startDate: current.startDate, endDate: current.endDate };
    }
  }

  await executor
    .update(projects)
    .set({ startDate: effectiveStart, endDate: effectiveEnd, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  // Issue #19: emit a `cascade-date-change` audit row per field that actually
  // moved, mirroring the cascade-status / cascade-duedate pattern. The
  // per-field gate (`effective[X] !== current[X]`) is also the no-double-write
  // guard: any field preserved by an in-batch date-override will be identical
  // to `current[X]` here, so no cascade row emits for that field. Mixed cases
  // (override on startDate + cascade move on endDate) emit a single endDate
  // row, sibling to the override's startDate row.
  if (auditContext && current) {
    const clientId = project?.clientId ?? null;
    const fields = [
      { field: "startDate" as const, previous: current.startDate, next: effectiveStart },
      { field: "endDate" as const, previous: current.endDate, next: effectiveEnd },
    ];
    for (const { field, previous, next } of fields) {
      if (previous === next) continue;
      const cascadeIdemKey = generateIdempotencyKey(
        "cascade-date-change",
        projectId,
        field,
        previous ?? "(null)",
        next ?? "(null)",
        auditContext.triggeredByUpdateId ?? "(no-trigger)",
      );
      await insertAuditRecord(
        {
          idempotencyKey: cascadeIdemKey,
          projectId,
          clientId,
          updatedBy: auditContext.updatedBy,
          updateType: "cascade-date-change",
          previousValue: previous,
          newValue: next,
          summary: `Project dates recomputed: ${field} ${previous ?? "(null)"} -> ${next ?? "(null)"}`,
          metadata: JSON.stringify({ field }),
          triggeredByUpdateId: auditContext.triggeredByUpdateId ?? null,
          source: auditContext.source ?? null,
        },
        executor,
      );
    }
  }

  return { startDate: effectiveStart, endDate: effectiveEnd };
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
  /** v4 explicit start date (ISO YYYY-MM-DD); falls back to `date` when omitted. */
  startDate?: string;
  /** v4 explicit end date (ISO YYYY-MM-DD) for multi-day spans. */
  endDate?: string;
  /** JSON-serialized array of week_item ids this item is blocked by, or null. */
  blockedBy?: string;
  updatedBy: string;
  /**
   * Wave 0b §A4: optional callback fired on successful insert. Wave 14
   * intercept-miss alert subscribes here. Pre-modal-era callers omit it.
   */
  auditObserver?: (event: AuditEvent) => void;
  /** Wave 0b §"Wave 0b" #7: write provenance. Pre-modal-era callers pass null/omit. */
  source?: AuditSource;
}

export async function createWeekItem(
  params: CreateWeekItemParams
): Promise<MutationResponse<{ clientName?: string; title: string }>> {
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
    startDate,
    endDate,
    blockedBy,
    updatedBy,
    auditObserver,
    source,
  } = params;

  // Helper-level value validation. batch_apply routes through here directly
  // (bypassing the MCP wrapper), so these checks are the only enforcement
  // point for batched ops. Reuses the shared validators hoisted to
  // operations-utils so MCP wrapper + helper stay in lockstep.
  if (status !== undefined) {
    const v = validateWeekItemStatus(status);
    if (!v.ok) return { ok: false, error: v.error };
  }
  if (category !== undefined) {
    const v = validateWeekItemCategory(category);
    if (!v.ok) return { ok: false, error: v.error };
  }
  for (const [label, value] of [
    ["date", date],
    ["startDate", startDate],
    ["endDate", endDate],
  ] as const) {
    if (value !== undefined) {
      const v = validateIsoDateShape(value, label);
      if (!v.ok) return { ok: false, error: v.error };
    }
  }

  // Wave 0b validators (pre-plan §A1) — every write path hits this gate.
  // Status / category compatibility (7-rule matrix). Empty inputs are
  // skipped — `validateStatusCategoryCompatibility` only fires on real
  // pairings, not on undefined defaults.
  if (status !== undefined && category !== undefined) {
    const sccResult = validateStatusCategoryCompatibility(status, category);
    if (!sccResult.ok) return { ok: false, error: sccResult.error };
  }

  // Role-tag on resources. Rejects bare names like "Kathy".
  if (resources !== undefined && resources !== null) {
    const r = validateRoleTagOnResources(resources);
    if (!r.ok) return { ok: false, error: r.error };
  }

  // startDate < endDate ordering (parity with addProject contract dates).
  const sed = validateStartEndDateOrder(startDate ?? null, endDate ?? null);
  if (!sed.ok) return { ok: false, error: sed.error };

  // L2 notes max length.
  if (notes !== undefined && notes !== null) {
    const n = validateNotesMaxLength(notes, "L2");
    if (!n.ok) return { ok: false, error: n.error };
  }

  // Auto-calculate weekOf from date or, for Range submissions that pass only
  // startDate, from startDate. Slack modal Range mode only supplies start/end
  // dates without a single anchor `date`, so this fallback prevents silent
  // write failure.
  const weekOf =
    rawWeekOf ??
    (date ? getMonday(date) : (startDate ? getMonday(startDate) : undefined));
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
  if (dup) return dup as MutationResponse<{ clientName?: string; title: string }>;

  const itemId = generateId();
  // Pre-generate the L2-create audit id so the cascade-date-change row can
  // link back via `triggered_by_update_id` (mirrors the parentAuditId pattern
  // in updateProjectStatus). The L2 create audit row is still written after
  // the transaction (with this id) per the existing flow.
  const createAuditId = generateId();
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
      // v4: explicit startDate / endDate take precedence; otherwise mirror
      // legacy `date` into `start_date` on create so derivation sees it.
      startDate: startDate ?? date ?? null,
      endDate: endDate ?? null,
      blockedBy: blockedBy ?? null,
      title,
      status: status ?? null,
      category: category ?? null,
      owner: resolvedOwner,
      resources: normalizedResources,
      notes: notes ?? null,
      sortOrder: 999,
    });
    if (projectId) {
      await recomputeProjectDatesWith(tx, projectId, {
        updatedBy,
        source: source ?? null,
        triggeredByUpdateId: createAuditId,
      });
    }
  });

  await insertAuditRecord({
    id: createAuditId,
    idempotencyKey: idemKey,
    clientId,
    updatedBy,
    updateType: "new-week-item",
    newValue: title,
    summary: `New week item${clientName ? ` (${clientName})` : ""}: ${title}`,
    source: source ?? null,
  });

  // Wave 0b §A4: emit AuditEvent for downstream observers.
  if (auditObserver) {
    auditObserver({
      source: source ?? null,
      entityId: itemId,
      entityType: "week_item",
      updatedBy,
    });
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
  /**
   * New field value. `null` is a first-class write — stored as SQL NULL,
   * audit-logged with `newValue = "(null)"` and an idempotency key that
   * also uses `"(null)"` so repeat null writes collapse. v4 convention
   * treats NULL as a canonical state (e.g., L2 status NULL = scheduled).
   */
  newValue: string | null;
  updatedBy: string;
  /** Wave 0b §A4: optional observer fired after successful update. */
  auditObserver?: (event: AuditEvent) => void;
  /** Wave 0b §"Wave 0b" #7: write provenance. */
  source?: AuditSource;
}

export async function updateWeekItemField(
  params: UpdateWeekItemFieldParams
): Promise<MutationResponse<UpdateWeekItemFieldData>> {
  const { weekOf, weekItemTitle, field, newValue, updatedBy, auditObserver, source } = params;
  const db = getRunwayDb();

  const fieldResult = validateAndResolveField(field, WEEK_ITEM_FIELDS, WEEK_ITEM_FIELD_TO_COLUMN);
  if (!fieldResult.ok) return fieldResult;
  const { typedField, columnKey } = fieldResult;

  const itemLookup = await resolveWeekItemOrFail(weekOf, weekItemTitle);
  if (!itemLookup.ok) return itemLookup;
  const item = itemLookup.item;

  const clientName = await getClientNameById(item.clientId);

  const previousValue = getPreviousValue(item, columnKey);

  // Helper-level value validation. batch_apply routes through here directly
  // (bypassing the MCP wrapper), so these checks are the only enforcement
  // point for batched ops. Reuses the shared validators hoisted to
  // operations-utils so MCP wrapper + helper stay in lockstep. `null` skips
  // (explicit clear write — handled by the persistence layer).
  if (typedField === "status" && newValue !== null) {
    const v = validateWeekItemStatus(newValue);
    if (!v.ok) return { ok: false, error: v.error };
  }
  if (typedField === "category" && newValue !== null) {
    const v = validateWeekItemCategory(newValue);
    if (!v.ok) return { ok: false, error: v.error };
  }
  if (
    (typedField === "date" || typedField === "startDate" || typedField === "endDate") &&
    newValue !== null
  ) {
    const v = validateIsoDateShape(newValue, typedField);
    if (!v.ok) return { ok: false, error: v.error };
  }

  // Wave 0b validators (pre-plan §A1) — fire on relevant field updates.
  // Status/category compatibility: re-check pairing using the new value plus
  // the existing OTHER side from `item`. Single-field writes can violate the
  // matrix even when individually valid (e.g. category=on-hold flipping while
  // status=in-production stays).
  if (typedField === "status" && newValue !== null) {
    const otherCategory = (item as { category?: string | null }).category ?? "";
    const sccResult = validateStatusCategoryCompatibility(newValue, otherCategory);
    if (!sccResult.ok) return { ok: false, error: sccResult.error };
  }
  if (typedField === "category" && newValue !== null) {
    const otherStatus = (item as { status?: string | null }).status ?? "";
    const sccResult = validateStatusCategoryCompatibility(otherStatus, newValue);
    if (!sccResult.ok) return { ok: false, error: sccResult.error };
  }
  // Role-tag on resources writes.
  if (typedField === "resources" && newValue !== null) {
    const r = validateRoleTagOnResources(newValue);
    if (!r.ok) return { ok: false, error: r.error };
  }
  // startDate < endDate parity: when updating one, compare against the OTHER
  // already on the row. Either side null skips.
  if (typedField === "startDate" && newValue !== null) {
    const otherEnd = (item as { endDate?: string | null }).endDate ?? null;
    const sed = validateStartEndDateOrder(newValue, otherEnd);
    if (!sed.ok) return { ok: false, error: sed.error };
  }
  if (typedField === "endDate" && newValue !== null) {
    const otherStart = (item as { startDate?: string | null }).startDate ?? null;
    const sed = validateStartEndDateOrder(otherStart, newValue);
    if (!sed.ok) return { ok: false, error: sed.error };
  }
  // L2 notes max length.
  if (typedField === "notes" && newValue !== null) {
    const n = validateNotesMaxLength(newValue, "L2");
    if (!n.ok) return { ok: false, error: n.error };
  }

  // v4 (Chunk 5): normalize resources on write so storage stays canonical.
  // Null short-circuits the normalizer so explicit null clears pass through.
  const effectiveNewValue: string | null =
    typedField === "resources" && newValue !== null
      ? normalizeResourcesString(newValue)
      : newValue;

  // Stable idempotency key for null writes — mirrors the "(null)" marker
  // used in audit rows so repeat applies collapse.
  const idemNewValue = effectiveNewValue ?? "(null)";
  const idemKey = generateIdempotencyKey(
    "week-field-change",
    item.id,
    field,
    idemNewValue,
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

  // Pre-generate the L2 field-change audit id so the cascade-date-change row
  // emitted inside recompute can link back via `triggered_by_update_id`.
  // Mirrors the parentAuditId pattern in updateProjectStatus / updateProjectField.
  const fieldChangeAuditId = generateId();

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
      await recomputeProjectDatesWith(tx, item.projectId, {
        updatedBy,
        source: source ?? null,
        triggeredByUpdateId: fieldChangeAuditId,
      });
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

  // Surface null as the literal "(null)" marker in the human-readable summary
  // so null writes render consistently.
  const summaryNewValue = effectiveNewValue ?? "(null)";

  const auditId = await insertAuditRecord({
    id: fieldChangeAuditId,
    idempotencyKey: idemKey,
    clientId: item.clientId,
    updatedBy,
    updateType: "week-field-change",
    previousValue,
    newValue: effectiveNewValue,
    summary: `Week item '${item.title}': ${field} changed from "${previousValue}" to "${summaryNewValue}"`,
    metadata: JSON.stringify({ field }),
    source: source ?? null,
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

  // Wave 0b §A4: emit AuditEvent for downstream observers.
  if (auditObserver) {
    auditObserver({
      source: source ?? null,
      entityId: item.id,
      entityType: "week_item",
      updatedBy,
    });
  }

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
): Promise<MutationResponse<{ clientName?: string }>> {
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
  if (dup) return dup as MutationResponse<{ clientName?: string }>;

  const clientName = await getClientNameById(item.clientId);
  const parentProjectId = item.projectId;

  // Pre-generate the delete audit id so the cascade-date-change row can link
  // back via `triggered_by_update_id`.
  const deleteAuditId = generateId();

  // v4 (Chunk 5): atomic delete + parent-date recompute.
  await db.transaction(async (tx) => {
    await tx.delete(weekItems).where(eq(weekItems.id, item.id));
    if (parentProjectId) {
      await recomputeProjectDatesWith(tx, parentProjectId, {
        updatedBy,
        triggeredByUpdateId: deleteAuditId,
      });
    }
  });

  await insertAuditRecord({
    id: deleteAuditId,
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
): Promise<
  MutationResponse<{
    weekItemTitle: string;
    previousProjectId: string | null;
    newProjectId: string;
    clientName?: string;
  }>
> {
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
  if (dup)
    return dup as MutationResponse<{
      weekItemTitle: string;
      previousProjectId: string | null;
      newProjectId: string;
      clientName?: string;
    }>;

  // Pre-generate the reparent audit id so the cascade-date-change row(s) on
  // either parent project (old + new) link back via `triggered_by_update_id`.
  const reparentAuditId = generateId();

  // v4 (Chunk 5): reparent + recompute both parents atomically. A crash
  // between the three writes could leave one or both parents with stale
  // derived dates; the transaction closes that window.
  //
  // Issue #20 (wrapper-clobber on link): the destination project's recompute
  // runs AFTER the L2 has been re-parented, so a retainer wrapper that had
  // no children pre-link now has exactly one L2 child (this one). The
  // retainer-guard in recomputeProjectDatesWith — extended for L2-only
  // wrappers as part of issue #8 — short-circuits at that point and the
  // wrapper's pinned start/end dates are preserved. No paired
  // overrideProjectDate workaround needed in callers. The reverse case
  // (linking the last L2 off a wrapper, leaving it fully childless) is
  // covered separately and intentionally falls through — a truly childless
  // retainer is a bootstrap edge case, not a steady state.
  await db.transaction(async (tx) => {
    await tx
      .update(weekItems)
      .set({ projectId, updatedAt: new Date() })
      .where(eq(weekItems.id, weekItemId));

    const cascadeAuditContext: RecomputeAuditContext = {
      updatedBy,
      triggeredByUpdateId: reparentAuditId,
    };
    if (previousProjectId && previousProjectId !== projectId) {
      await recomputeProjectDatesWith(tx, previousProjectId, cascadeAuditContext);
    }
    await recomputeProjectDatesWith(tx, projectId, cascadeAuditContext);
  });

  await insertAuditRecord({
    id: reparentAuditId,
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
