/**
 * Runway Add Operations — new projects and free-form updates
 *
 * Separated from operations-writes.ts to keep files under 150 lines.
 * Uses shared queries from operations.ts for client/project lookup.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, updates } from "@/lib/db/runway-schema";
import {
  generateIdempotencyKey,
  generateId,
  getClientBySlug,
  findProjectByFuzzyName,
  checkIdempotency,
} from "./operations";
import type { OperationResult } from "./operations-writes";

export interface AddProjectParams {
  clientSlug: string;
  name: string;
  status?: string;
  category?: string;
  owner?: string;
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
    notes,
    updatedBy,
  } = params;
  const db = getRunwayDb();

  const client = await getClientBySlug(clientSlug);
  if (!client) {
    return { ok: false, error: `Client '${clientSlug}' not found.` };
  }

  const idemKey = generateIdempotencyKey(
    "add-project",
    client.id,
    name,
    updatedBy
  );

  if (await checkIdempotency(idemKey)) {
    return { ok: true, message: "Project already added (duplicate request)." };
  }

  const projectId = generateId();
  await db.insert(projects).values({
    id: projectId,
    clientId: client.id,
    name,
    status,
    category,
    owner: owner ?? null,
    notes: notes ?? null,
    sortOrder: 999,
  });

  await db.insert(updates).values({
    id: generateId(),
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
  const db = getRunwayDb();

  const client = await getClientBySlug(clientSlug);
  if (!client) {
    return { ok: false, error: `Client '${clientSlug}' not found.` };
  }

  let projectId: string | null = null;
  let projectMatch: string | undefined;
  if (projectName) {
    const project = await findProjectByFuzzyName(client.id, projectName);
    projectId = project?.id ?? null;
    projectMatch = project?.name;
  }

  const idemKey = generateIdempotencyKey(
    "note",
    client.id,
    summary,
    updatedBy,
    new Date().toISOString().slice(0, 16)
  );

  if (await checkIdempotency(idemKey)) {
    return { ok: true, message: "Update already logged (duplicate request)." };
  }

  await db.insert(updates).values({
    id: generateId(),
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
