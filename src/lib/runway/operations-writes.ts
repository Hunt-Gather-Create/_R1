/**
 * Runway Write Operations — project status changes
 *
 * Handles status updates with idempotency checks and audit logging.
 * Uses shared queries from operations.ts for client/project lookup.
 *
 * See also: operations-add.ts for addProject and addUpdate.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, weekItems } from "@/lib/db/runway-schema";
import { eq } from "drizzle-orm";
import {
  CASCADE_STATUSES,
  TERMINAL_ITEM_STATUSES,
  generateIdempotencyKey,
  getClientOrFail,
  resolveProjectOrFail,
  checkDuplicate,
  insertAuditRecord,
  getLinkedWeekItems,
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

  const lookup = await getClientOrFail(clientSlug);
  if (!lookup.ok) return lookup;
  const { client } = lookup;

  const projectLookup = await resolveProjectOrFail(client.id, client.name, projectName);
  if (!projectLookup.ok) return projectLookup;
  const project = projectLookup.project;

  const previousStatus = project.status;
  const idemKey = generateIdempotencyKey(
    "status-change",
    project.id,
    newStatus,
    updatedBy
  );

  const dup = await checkDuplicate(idemKey, {
    ok: true,
    message: "Update already applied (duplicate request).",
    data: { clientName: client.name, projectName: project.name, previousStatus, newStatus },
  });
  if (dup) return dup;

  await db
    .update(projects)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: project.id,
    clientId: client.id,
    updatedBy,
    updateType: "status-change",
    previousValue: previousStatus,
    newValue: newStatus,
    summary: `${client.name} / ${project.name}: ${previousStatus} -> ${newStatus}${notes ? `. ${notes}` : ""}`,
  });

  // Cascade to linked week items for terminal/blocking statuses
  const cascadedItems: string[] = [];
  const shouldCascade = (CASCADE_STATUSES as readonly string[]).includes(newStatus);

  if (shouldCascade) {
    const linkedItems = await getLinkedWeekItems(project.id);
    for (const item of linkedItems) {
      const itemAlreadyTerminal = (TERMINAL_ITEM_STATUSES as readonly string[]).includes(item.status ?? "");

      if (!itemAlreadyTerminal) {
        await db
          .update(weekItems)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(weekItems.id, item.id));
        cascadedItems.push(item.title);
      }
    }
  }

  return {
    ok: true,
    message: `Updated ${client.name} / ${project.name}: ${previousStatus} -> ${newStatus}`,
    data: {
      clientName: client.name,
      projectName: project.name,
      previousStatus,
      newStatus,
      cascadedItems,
    },
  };
}
