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
  checkDuplicate,
  insertAuditRecord,
} from "./operations";
import type { OperationResult } from "./operations-writes";

export interface AddProjectParams {
  clientSlug: string;
  name: string;
  status?: string;
  category?: string;
  owner?: string;
  resources?: string;
  dueDate?: string;
  target?: string;
  waitingOn?: string;
  notes?: string;
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
): Promise<OperationResult> {
  const {
    clientSlug,
    name,
    status = "not-started",
    category = "active",
    owner,
    resources,
    dueDate,
    target,
    waitingOn,
    notes,
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

  const idemKey = generateIdempotencyKey(
    "add-project",
    client.id,
    name,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true, message: "Project already added (duplicate request).",
  });
  if (dup) return dup;

  const projectId = generateId();
  await db.insert(projects).values({
    id: projectId,
    clientId: client.id,
    name,
    status,
    category,
    owner: owner ?? null,
    resources: resources ?? null,
    dueDate: dueDate ?? null,
    target: target ?? null,
    waitingOn: waitingOn ?? null,
    notes: notes ?? null,
    sortOrder: 999,
  });

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
): Promise<OperationResult> {
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
  if (dup) return dup;

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
