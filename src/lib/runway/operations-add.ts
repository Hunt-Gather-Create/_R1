/**
 * Runway Add Operations — new projects and free-form updates
 *
 * Separated from operations-writes.ts to keep files under 150 lines.
 * Uses shared queries from operations.ts for client/project lookup.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  generateId,
  getClientOrFail,
  findProjectByFuzzyName,
  resolveProjectOrFail,
  normalizeForMatch,
  normalizeResourcesString,
  checkDuplicate,
  insertAuditRecord,
  validateParentProjectIdAssignment,
} from "./operations";
import type { MutationResponse } from "./mutation-response";

export interface AddProjectParams {
  clientSlug: string;
  name: string;
  status?: string;
  category?: string;
  owner?: string;
  resources?: string;
  dueDate?: string;
  waitingOn?: string;
  notes?: string;
  /** v4 retainer metadata (optional). engagementType: "retainer" | "project" | null. */
  engagementType?: string | null;
  /** ISO YYYY-MM-DD or null. */
  contractStart?: string | null;
  /** ISO YYYY-MM-DD or null. */
  contractEnd?: string | null;
  /** ISO YYYY-MM-DD or null. */
  startDate?: string | null;
  /** ISO YYYY-MM-DD or null. */
  endDate?: string | null;
  /** Wrapper project id (must be retainer + same client + non-cyclic) or null. */
  parentProjectId?: string | null;
  updatedBy: string;
}

export interface AddUpdateParams {
  clientSlug: string;
  projectName?: string;
  summary: string;
  updatedBy: string;
}

export async function addProject(
  params: AddProjectParams
): Promise<MutationResponse<{ clientName: string; projectName: string }>> {
  const {
    clientSlug,
    name,
    status = "not-started",
    category = "active",
    owner,
    resources,
    dueDate,
    waitingOn,
    notes,
    engagementType,
    contractStart,
    contractEnd,
    startDate,
    endDate,
    parentProjectId,
    updatedBy,
  } = params;
  const db = getRunwayDb();

  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const { client } = lookup;

  // Check for duplicate project name (exact case-insensitive match)
  const existing = await findProjectByFuzzyName(client.id, name);
  if (existing && normalizeForMatch(existing.name) === normalizeForMatch(name)) {
    return {
      ok: false,
      error: `A project named '${existing.name}' already exists under ${client.name}. Did you mean to update it?`,
    };
  }

  // Cross-field invariant: when both contract dates are provided in the same
  // call, end must be strictly after start.
  if (
    contractStart !== undefined && contractStart !== null &&
    contractEnd !== undefined && contractEnd !== null &&
    contractStart >= contractEnd
  ) {
    return {
      ok: false,
      error: `contractStart '${contractStart}' must be < contractEnd '${contractEnd}'.`,
    };
  }

  const idemKey = generateIdempotencyKey(
    "add-project",
    client.id,
    name,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Project already added (duplicate request).",
    data: { clientName: client.name, projectName: name },
  });
  if (dup) return dup as MutationResponse<{ clientName: string; projectName: string }>;

  const projectId = generateId();
  // v4 (Chunk 5): normalize resources on write so storage stays canonical.
  const normalizedResources = resources ? normalizeResourcesString(resources) : null;

  // tx-wrap insert + parentProjectId validation so a validator failure rolls
  // back the project insert. parentProjectId === undefined / null skips the
  // check (no link is being set).
  const ROLLBACK_SENTINEL = "__addProject_validation_rollback__";
  let validationError: string | null = null;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: projectId,
        clientId: client.id,
        name,
        status,
        category,
        owner: owner ?? null,
        resources: normalizedResources,
        dueDate: dueDate ?? null,
        waitingOn: waitingOn ?? null,
        notes: notes ?? null,
        engagementType: engagementType ?? null,
        contractStart: contractStart ?? null,
        contractEnd: contractEnd ?? null,
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        parentProjectId: parentProjectId ?? null,
        sortOrder: 999,
      });

      if (parentProjectId !== undefined && parentProjectId !== null) {
        const v = await validateParentProjectIdAssignment(tx, {
          childId: projectId,
          childClientId: client.id,
          newParentId: parentProjectId,
        });
        if (!v.ok) {
          validationError = v.error;
          throw new Error(ROLLBACK_SENTINEL);
        }
      }
    });
  } catch (err) {
    if (validationError !== null) {
      return { ok: false, error: validationError };
    }
    throw err;
  }

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId,
    clientId: client.id,
    updatedBy,
    updateType: "new-item",
    newValue: name,
    summary: `New project added to ${client.name}: ${name}`,
  });

  return {
    ok: true,
    message: `Added project '${name}' to ${client.name}.`,
    data: { clientName: client.name, projectName: name },
  };
}

export async function addUpdate(
  params: AddUpdateParams
): Promise<MutationResponse<{ clientName: string; projectName?: string }>> {
  const { clientSlug, projectName, summary, updatedBy } = params;

  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const { client } = lookup;

  let projectId: string | null = null;
  let projectMatch: string | undefined;
  if (projectName) {
    const resolved = await resolveProjectOrFail(client.id, client.name, projectName);
    if (resolved.ok) {
      projectId = resolved.project.id;
      projectMatch = resolved.project.name;
    } else if (resolved.error.startsWith("Multiple")) {
      // Ambiguous match — return error so user can disambiguate
      return resolved;
    }
    // Not found — leave projectId null, note is client-level
  }

  const idemKey = generateIdempotencyKey(
    "note",
    client.id,
    summary,
    updatedBy,
    new Date().toISOString().slice(0, 16)
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Update already logged (duplicate request).",
    data: { clientName: client.name, projectName: projectMatch },
  });
  if (dup) return dup as MutationResponse<{ clientName: string; projectName?: string }>;

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId,
    clientId: client.id,
    updatedBy,
    updateType: "note",
    summary: `${client.name}: ${summary}`,
  });

  return {
    ok: true,
    message: `Update logged for ${client.name}.`,
    data: { clientName: client.name, projectName: projectMatch },
  };
}
