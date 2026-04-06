/**
 * Runway Write Operations — project status changes
 *
 * Handles status updates with idempotency checks and audit logging.
 * Uses shared queries from operations.ts for client/project lookup.
 *
 * See also: operations-add.ts for addProject and addUpdate.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, updates } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";
import {
  generateIdempotencyKey,
  generateId,
  getClientBySlug,
  findProjectByFuzzyName,
  getProjectsForClient,
  checkIdempotency,
  clientNotFoundError,
} from "./operations";

// ── Types ────────────────────────────────────────────────

export interface UpdateProjectStatusParams {
  clientSlug: string;
  projectName: string;
  newStatus: string;
  updatedBy: string;
  notes?: string;
}

export type OperationResult =
  | { ok: true; message: string; data?: Record<string, unknown> }
  | { ok: false; error: string; available?: string[] };

// ── Write Operation ─────────────────────────────────────

export async function updateProjectStatus(
  params: UpdateProjectStatusParams
): Promise<OperationResult> {
  const { clientSlug, projectName, newStatus, updatedBy, notes } = params;
  const db = getRunwayDb();

  const client = await getClientBySlug(clientSlug);
  if (!client) return clientNotFoundError(clientSlug);

  const project = await findProjectByFuzzyName(client.id, projectName);
  if (!project) {
    const clientProjects = await getProjectsForClient(client.id);
    return {
      ok: false,
      error: `Project '${projectName}' not found for ${client.name}.`,
      available: clientProjects.map((p) => p.name),
    };
  }

  const previousStatus = project.status;
  const idemKey = generateIdempotencyKey(
    "status-change",
    project.id,
    newStatus,
    updatedBy
  );

  if (await checkIdempotency(idemKey)) {
    return { ok: true, message: "Update already applied (duplicate request)." };
  }

  await db
    .update(projects)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  const summary = `${client.name} / ${project.name}: ${previousStatus} -> ${newStatus}${notes ? `. ${notes}` : ""}`;
  await db.insert(updates).values({
    id: generateId(),
    idempotencyKey: idemKey,
    projectId: project.id,
    clientId: client.id,
    updatedBy,
    updateType: "status-change",
    previousValue: previousStatus,
    newValue: newStatus,
    summary,
  });

  return {
    ok: true,
    message: `Updated ${client.name} / ${project.name}: ${previousStatus} -> ${newStatus}`,
    data: {
      clientName: client.name,
      projectName: project.name,
      previousStatus,
      newStatus,
    },
  };
}
