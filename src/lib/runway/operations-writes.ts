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
  generateId,
  getClientOrFail,
  resolveProjectOrFail,
  checkDuplicate,
  insertAuditRecord,
} from "./operations-utils";
import { getLinkedWeekItems } from "./operations-reads-week";
import type {
  CascadedItemInfo,
  MutationResponse,
  UpdateProjectStatusData,
} from "./mutation-response";

// ── Types ────────────────────────────────────────────────

export interface UpdateProjectStatusParams {
  clientSlug: string;
  projectName: string;
  newStatus: string;
  updatedBy: string;
  notes?: string;
}

// ── Write Operation ─────────────────────────────────────

export async function updateProjectStatus(
  params: UpdateProjectStatusParams
): Promise<MutationResponse<UpdateProjectStatusData>> {
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
    data: {
      clientName: client.name,
      projectName: project.name,
      previousStatus,
      newStatus,
      cascadedItems: [],
      cascadeDetail: [],
    },
  });
  if (dup) return dup as MutationResponse<UpdateProjectStatusData>;

  // Pre-generate the parent audit id so cascade children can link via triggeredByUpdateId.
  const parentAuditId = generateId();

  // Cascade to ALL linked week items for terminal/blocking statuses (v4 §7:
  // cascade applies to every L2 category, not just `deadline`).
  //
  // Chunk 5 debt §12.2: capture (id, title, previousStatus) tuples inside the
  // transaction so post-commit audit rows don't need to re-query
  // getLinkedWeekItems. The second query could race against concurrent writes
  // and would be vulnerable to title collisions within a single project.
  // `previousStatus` feeds the structured `cascadeDetail` emitted to MCP
  // consumers (PR #86).
  const cascaded: Array<{ id: string; title: string; previousStatus: string | null }> = [];
  const shouldCascade = (CASCADE_STATUSES as readonly string[]).includes(newStatus);

  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    if (shouldCascade) {
      const linkedItems = await getLinkedWeekItems(project.id);
      for (const item of linkedItems) {
        const itemAlreadyTerminal = (TERMINAL_ITEM_STATUSES as readonly string[]).includes(item.status ?? "");
        if (!itemAlreadyTerminal) {
          await tx
            .update(weekItems)
            .set({ status: newStatus, updatedAt: new Date() })
            .where(eq(weekItems.id, item.id));
          cascaded.push({
            id: item.id,
            title: item.title,
            previousStatus: item.status ?? null,
          });
        }
      }
    }
  });

  // Parent audit record (single row). Use the pre-generated id so child cascade
  // rows can reference it via triggeredByUpdateId.
  await insertAuditRecord({
    id: parentAuditId,
    idempotencyKey: idemKey,
    projectId: project.id,
    clientId: client.id,
    updatedBy,
    updateType: "status-change",
    previousValue: previousStatus,
    newValue: newStatus,
    summary: `${client.name} / ${project.name}: ${previousStatus} -> ${newStatus}${notes ? `. ${notes}` : ""}`,
  });

  // v4 §8: write a cascade audit row per affected L2, linked to the parent update.
  // This gives the updates channel + undo tooling an explicit trail. Capture
  // each child's audit id so we can surface it in the structured
  // `cascadeDetail` response (PR #86).
  const cascadeDetail: CascadedItemInfo[] = [];
  for (const { id: itemId, title, previousStatus: itemPrev } of cascaded) {
    const childIdemKey = generateIdempotencyKey(
      "cascade-status",
      parentAuditId,
      itemId,
      newStatus
    );
    const childAuditId = await insertAuditRecord({
      idempotencyKey: childIdemKey,
      projectId: project.id,
      clientId: client.id,
      updatedBy,
      updateType: "cascade-status",
      previousValue: null,
      newValue: newStatus,
      summary: `Cascaded from ${project.name} status change: ${title} → ${newStatus}`,
      metadata: JSON.stringify({ weekItemId: itemId, field: "status" }),
      triggeredByUpdateId: parentAuditId,
    });
    cascadeDetail.push({
      itemId,
      itemTitle: title,
      field: "status",
      previousValue: itemPrev,
      newValue: newStatus,
      auditId: childAuditId,
    });
  }

  return {
    ok: true,
    message: `Updated ${client.name} / ${project.name}: ${previousStatus} -> ${newStatus}`,
    data: {
      clientName: client.name,
      projectName: project.name,
      previousStatus,
      newStatus,
      cascadedItems: cascaded.map((c) => c.title),
      cascadeDetail,
      auditId: parentAuditId,
    },
  };
}
