/**
 * Runway Write Operations — client create and field updates
 *
 * Create new clients and update individual fields (team, contractStatus, etc.)
 * with idempotency checks and audit logging.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { clients } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";
import {
  CLIENT_FIELDS,
  CLIENT_FIELD_TO_COLUMN,
  generateIdempotencyKey,
  generateId,
  getClientOrFail,
  getClientBySlug,
  invalidateClientCache,
  checkDuplicate,
  insertAuditRecord,
  validateAndResolveField,
  getPreviousValue,
  normalizeResourcesString,
} from "./operations-utils";
import type { OperationResult } from "./operations-utils";

// ── Create Client ───────────────────────────────────────

export interface CreateClientParams {
  name: string;
  slug: string;
  nicknames?: string;
  team?: string;
  contractValue?: string;
  contractTerm?: string;
  contractStatus?: string;
  clientContacts?: string;
  updatedBy: string;
}

export async function createClient(
  params: CreateClientParams
): Promise<OperationResult> {
  const {
    name,
    slug,
    nicknames,
    team,
    contractValue,
    contractTerm,
    contractStatus,
    clientContacts,
    updatedBy,
  } = params;
  const db = getRunwayDb();

  // Check for existing client with same slug
  const existing = await getClientBySlug(slug);
  if (existing) {
    return {
      ok: false,
      error: `A client with slug '${slug}' already exists (${existing.name}).`,
    };
  }

  const idemKey = generateIdempotencyKey(
    "create-client",
    slug,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Client already created (duplicate request).",
    data: { clientName: name, slug },
  });
  if (dup) return dup;

  const clientId = generateId();
  // v4 (Chunk 5 debt §14.1): normalize `team` on write — mirrors
  // updateClientField so create/update paths store canonical roster format.
  const normalizedTeam = team ? normalizeResourcesString(team) : null;
  await db.insert(clients).values({
    id: clientId,
    name,
    slug,
    nicknames: nicknames ?? null,
    team: normalizedTeam,
    contractValue: contractValue ?? null,
    contractTerm: contractTerm ?? null,
    contractStatus: contractStatus ?? null,
    clientContacts: clientContacts ?? null,
  });

  // Invalidate the client cache so subsequent lookups find the new client
  invalidateClientCache();

  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId,
    updatedBy,
    updateType: "new-client",
    newValue: name,
    summary: `New client added: ${name} (${slug})`,
  });

  return {
    ok: true,
    message: `Added client '${name}'.`,
    data: { clientName: name, slug },
  };
}

// ── Update Client Field ─────────────────────────────────

export interface UpdateClientFieldParams {
  clientSlug: string;
  field: string;
  newValue: string;
  updatedBy: string;
}

export async function updateClientField(
  params: UpdateClientFieldParams
): Promise<OperationResult> {
  const { clientSlug, field, newValue, updatedBy } = params;
  const db = getRunwayDb();

  const fieldResult = validateAndResolveField(field, CLIENT_FIELDS, CLIENT_FIELD_TO_COLUMN);
  if (!fieldResult.ok) return fieldResult;
  const { typedField, columnKey } = fieldResult;

  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const { client } = lookup;

  const previousValue = getPreviousValue(client, columnKey);

  // v4 (Chunk 5): normalize `team` on write — it uses the same role-prefix
  // roster format as L1/L2 resources.
  const effectiveNewValue =
    typedField === "team" ? normalizeResourcesString(newValue) : newValue;

  const idemKey = generateIdempotencyKey(
    "client-field-change",
    client.id,
    field,
    effectiveNewValue,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Update already applied (duplicate request).",
    data: { clientName: client.name, field, previousValue, newValue: effectiveNewValue },
  });
  if (dup) return dup;

  await db
    .update(clients)
    .set({ [columnKey]: effectiveNewValue, updatedAt: new Date() })
    .where(eq(clients.id, client.id));

  // Invalidate cache since client data changed
  invalidateClientCache();

  await insertAuditRecord({
    idempotencyKey: idemKey,
    clientId: client.id,
    updatedBy,
    updateType: "client-field-change",
    previousValue,
    newValue: effectiveNewValue,
    summary: `${client.name}: ${field} changed from "${previousValue}" to "${effectiveNewValue}"`,
    metadata: JSON.stringify({ field }),
  });

  return {
    ok: true,
    message: `Updated ${field} for ${client.name}.`,
    data: { clientName: client.name, field, previousValue, newValue: effectiveNewValue },
  };
}
