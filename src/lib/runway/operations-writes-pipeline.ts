/**
 * Runway Write Operations — pipeline item CRUD
 *
 * Create, update, and delete pipeline items (unsigned SOWs, new business).
 * All writes go through the audit trail via insertAuditRecord().
 */

import { getRunwayDb } from "@/lib/db/runway";
import { pipelineItems } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";
import {
  PIPELINE_ITEM_FIELDS,
  PIPELINE_ITEM_FIELD_TO_COLUMN,
  generateIdempotencyKey,
  generateId,
  getClientOrFail,
  resolvePipelineItemOrFail,
  checkDuplicate,
  insertAuditRecord,
  validateAndResolveField,
  getPreviousValue,
} from "./operations-utils";
import type { MutationResponse } from "./mutation-response";

// ── Create Pipeline Item ────────────────────────────────

export interface CreatePipelineItemParams {
  clientSlug?: string;
  name: string;
  owner?: string;
  status?: string;
  estimatedValue?: string;
  waitingOn?: string;
  notes?: string;
  updatedBy: string;
}

export async function createPipelineItem(
  params: CreatePipelineItemParams
): Promise<MutationResponse<{ clientName?: string; name: string }>> {
  const {
    clientSlug,
    name,
    owner,
    status,
    estimatedValue,
    waitingOn,
    notes,
    updatedBy,
  } = params;
  const db = getRunwayDb();

  let clientId: string | null = null;
  let clientName: string | undefined;

  if (clientSlug) {
    const lookup = await getClientOrFail(clientSlug);
    if (!lookup.ok) return lookup;
    clientId = lookup.client.id;
    clientName = lookup.client.name;
  }

  const idemKey = generateIdempotencyKey(
    "create-pipeline-item",
    clientId ?? "none",
    name,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Pipeline item already created (duplicate request).",
    data: { clientName, name },
  });
  if (dup) return dup as MutationResponse<{ clientName?: string; name: string }>;

  const itemId = generateId();
  await db.insert(pipelineItems).values({
    id: itemId,
    clientId,
    name,
    owner: owner ?? null,
    status: status ?? null,
    estimatedValue: estimatedValue ?? null,
    waitingOn: waitingOn ?? null,
    notes: notes ?? null,
    sortOrder: 999,
  });

  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId,
    updatedBy,
    updateType: "new-pipeline-item",
    newValue: name,
    summary: `New pipeline item${clientName ? ` (${clientName})` : ""}: ${name}`,
  });

  return {
    ok: true,
    message: `Added pipeline item '${name}'${clientName ? ` for ${clientName}` : ""}.`,
    data: { clientName, name },
  };
}

// ── Update Pipeline Item Field ──────────────────────────

export interface UpdatePipelineItemParams {
  clientSlug: string;
  pipelineName: string;
  field: string;
  newValue: string;
  updatedBy: string;
}

export async function updatePipelineItem(
  params: UpdatePipelineItemParams
): Promise<
  MutationResponse<{
    clientName: string;
    pipelineName: string;
    field: string;
    previousValue: string;
    newValue: string;
  }>
> {
  const { clientSlug, pipelineName, field, newValue, updatedBy } = params;
  const db = getRunwayDb();

  const fieldResult = validateAndResolveField(field, PIPELINE_ITEM_FIELDS, PIPELINE_ITEM_FIELD_TO_COLUMN);
  if (!fieldResult.ok) return fieldResult;
  const { columnKey } = fieldResult;

  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const { client } = lookup;

  const itemLookup = await resolvePipelineItemOrFail(client.id, client.name, pipelineName);
  if (!itemLookup.ok) return itemLookup;
  const item = itemLookup.item;

  const previousValue = getPreviousValue(item, columnKey);

  const idemKey = generateIdempotencyKey(
    "pipeline-field-change",
    item.id,
    field,
    newValue,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Update already applied (duplicate request).",
    data: { clientName: client.name, pipelineName: item.name, field, previousValue, newValue },
  });
  if (dup)
    return dup as MutationResponse<{
      clientName: string;
      pipelineName: string;
      field: string;
      previousValue: string;
      newValue: string;
    }>;

  await db
    .update(pipelineItems)
    .set({ [columnKey]: newValue, updatedAt: new Date() })
    .where(eq(pipelineItems.id, item.id));

  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId: client.id,
    updatedBy,
    updateType: "pipeline-field-change",
    previousValue,
    newValue,
    summary: `${client.name} / ${item.name}: ${field} changed from "${previousValue}" to "${newValue}"`,
    metadata: JSON.stringify({ field }),
  });

  return {
    ok: true,
    message: `Updated ${field} for ${client.name} / ${item.name}.`,
    data: { clientName: client.name, pipelineName: item.name, field, previousValue, newValue },
  };
}

// ── Delete Pipeline Item ────────────────────────────────

export interface DeletePipelineItemParams {
  clientSlug: string;
  pipelineName: string;
  updatedBy: string;
}

export async function deletePipelineItem(
  params: DeletePipelineItemParams
): Promise<MutationResponse<{ clientName: string; pipelineName: string }>> {
  const { clientSlug, pipelineName, updatedBy } = params;
  const db = getRunwayDb();

  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const { client } = lookup;

  const itemLookup = await resolvePipelineItemOrFail(client.id, client.name, pipelineName);
  if (!itemLookup.ok) return itemLookup;
  const item = itemLookup.item;

  const idemKey = generateIdempotencyKey(
    "delete-pipeline-item",
    item.id,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Pipeline item already deleted (duplicate request).",
    data: { clientName: client.name, pipelineName: item.name },
  });
  if (dup) return dup as MutationResponse<{ clientName: string; pipelineName: string }>;

  await db.delete(pipelineItems).where(eq(pipelineItems.id, item.id));

  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId: client.id,
    updatedBy,
    updateType: "delete-pipeline-item",
    previousValue: item.name,
    summary: `Deleted pipeline item from ${client.name}: ${item.name}`,
  });

  return {
    ok: true,
    message: `Deleted pipeline item '${item.name}' from ${client.name}.`,
    data: { clientName: client.name, pipelineName: item.name },
  };
}
