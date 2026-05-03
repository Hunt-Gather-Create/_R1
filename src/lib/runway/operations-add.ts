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
  validateEngagementType,
  validateIsoDateShape,
  validateStatusCategoryCompatibility,
  validateRoleTagOnResources,
  validateStartEndDateOrder,
  validateNotesMaxLength,
} from "./operations";
import type {
  AuditEvent,
  AuditSource,
} from "./operations-utils";
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
  /**
   * Wave 0b §A4: optional callback fired on successful insert. Wave 14's
   * intercept-miss alert subscribes here without inline grep across helpers.
   * Pass undefined (or omit) for legacy callers — observer is purely additive.
   */
  auditObserver?: (event: AuditEvent) => void;
  /**
   * Wave 0b §"Wave 0b" #7: where this write originated. Pre-modal-era rows
   * passed null; modal Phase 1 surfaces pass `slack-modal-bot` /
   * `slack-modal-slash`. Optional — existing call sites that haven't been
   * migrated yet pass nothing and the observer (if registered) sees `null`.
   */
  source?: AuditSource;
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
    auditObserver,
    source,
  } = params;
  const db = getRunwayDb();

  // Helper-level value validation. The MCP wrapper validates these too, but
  // batch_apply routes through the helper directly — so this branch is the
  // only enforcement point for those calls. Reuses the shared validators
  // hoisted to operations-utils so MCP wrapper + helper stay in lockstep.
  if (engagementType !== undefined && engagementType !== null) {
    const v = validateEngagementType(engagementType);
    if (!v.ok) return { ok: false, error: v.error };
  }
  for (const [label, value] of [
    ["contractStart", contractStart],
    ["contractEnd", contractEnd],
    ["startDate", startDate],
    ["endDate", endDate],
  ] as const) {
    if (value !== undefined && value !== null) {
      const v = validateIsoDateShape(value, label);
      if (!v.ok) return { ok: false, error: v.error };
    }
  }

  // Wave 0b validators (pre-plan §A1) — every write path hits this gate.
  // Status / category compatibility (7-rule matrix). Soft-warn case
  // (`blocked` + `active`) is surfaced as an error to the caller — modal
  // submission may downgrade it to a warning, but direct callers (MCP /
  // batch / migration) treat it as a reject for safety.
  const sccResult = validateStatusCategoryCompatibility(status, category);
  if (!sccResult.ok) return { ok: false, error: sccResult.error };

  // Role-tag on resources. Rejects bare names like "Kathy".
  if (resources !== undefined && resources !== null) {
    const r = validateRoleTagOnResources(resources);
    if (!r.ok) return { ok: false, error: r.error };
  }

  // startDate < endDate ordering parity rule (mirrors the existing
  // contractStart < contractEnd check below). Either side null skips.
  const sed = validateStartEndDateOrder(startDate ?? null, endDate ?? null);
  if (!sed.ok) return { ok: false, error: sed.error };

  // L1 notes max length. Empty / null skips.
  if (notes !== undefined && notes !== null) {
    const n = validateNotesMaxLength(notes, "L1");
    if (!n.ok) return { ok: false, error: n.error };
  }

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

  // Wave 0b §A4: emit AuditEvent for downstream observers (Wave 14
  // intercept-miss alert). Source nullable per pre-plan §A4 — pre-modal-era
  // callers that don't pass `source` see null.
  if (auditObserver) {
    auditObserver({
      source: source ?? null,
      entityId: projectId,
      entityType: "project",
      updatedBy,
    });
  }

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
