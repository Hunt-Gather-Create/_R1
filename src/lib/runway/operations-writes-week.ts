/**
 * Runway Write Operations — week item create and update
 *
 * Handles creating new week items and updating individual fields
 * with idempotency checks and audit logging.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { weekItems } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";
import {
  WEEK_ITEM_FIELDS,
  WEEK_ITEM_FIELD_TO_COLUMN,
  generateIdempotencyKey,
  generateId,
  getClientOrFail,
  findProjectByFuzzyName,
  resolveWeekItemOrFail,
  checkDuplicate,
  insertAuditRecord,
  validateField,
} from "./operations-utils";
import type { WeekItemField } from "./operations-utils";
import type { OperationResult } from "./operations-writes";

// ── Create Week Item ─────────────────────────────────────

export interface CreateWeekItemParams {
  clientSlug?: string;
  projectName?: string;
  weekOf: string;
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
    weekOf,
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

  const fieldError = validateField(field, WEEK_ITEM_FIELDS);
  if (fieldError) return fieldError;

  const typedField = field as WeekItemField;

  const itemLookup = await resolveWeekItemOrFail(weekOf, weekItemTitle);
  if (!itemLookup.ok) return itemLookup;
  const item = itemLookup.item;

  const columnKey = WEEK_ITEM_FIELD_TO_COLUMN[typedField];
  const previousValue = String(item[columnKey] ?? "");

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

  await db
    .update(weekItems)
    .set({ [columnKey]: newValue, updatedAt: new Date() })
    .where(eq(weekItems.id, item.id));

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

  return {
    ok: true,
    message: `Updated ${field} for '${item.title}'.`,
    data: { weekItemTitle: item.title, field, previousValue, newValue },
  };
}
