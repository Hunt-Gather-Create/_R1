/**
 * Runway Write Operations — undo last change
 *
 * Reverts the most recent status-change or field-change made by a user.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, updates } from "@/lib/db/runway-schema";
import { eq, desc } from "drizzle-orm";
import {
  UNDO_FIELDS,
  generateIdempotencyKey,
  checkIdempotency,
  insertAuditRecord,
} from "./operations-utils";
import type { OperationResult } from "./operations-writes";

const UNDOABLE_TYPES = ["status-change", "field-change"];
const MAX_UNDO_SCAN = 50;

export async function undoLastChange(params: {
  updatedBy: string;
}): Promise<OperationResult> {
  const { updatedBy } = params;
  const db = getRunwayDb();

  // Find the most recent undoable change by this user (bounded scan)
  const recentUpdates = await db
    .select()
    .from(updates)
    .where(eq(updates.updatedBy, updatedBy))
    .orderBy(desc(updates.createdAt), desc(updates.id))
    .limit(MAX_UNDO_SCAN);

  // Walk the list, skipping records that have already been undone
  let lastChange: typeof recentUpdates[number] | undefined;
  for (const u of recentUpdates) {
    if (!u.updateType || !UNDOABLE_TYPES.includes(u.updateType)) continue;
    const undoKey = generateIdempotencyKey("undo", u.id, updatedBy);
    if (await checkIdempotency(undoKey)) continue;
    lastChange = u;
    break;
  }

  if (!lastChange) {
    return { ok: false, error: "No recent change to undo." };
  }

  const idemKey = generateIdempotencyKey("undo", lastChange.id, updatedBy);

  if (!lastChange.projectId) {
    return {
      ok: false,
      error: "Cannot undo: missing project reference.",
    };
  }

  // Determine what to revert (null previousValue is valid — means "set back to null")
  if (lastChange.updateType === "status-change") {
    await db
      .update(projects)
      .set({ status: lastChange.previousValue ?? "not-started", updatedAt: new Date() })
      .where(eq(projects.id, lastChange.projectId));
  } else if (lastChange.updateType === "field-change") {
    // Prefer structured metadata; fall back to regex for pre-migration records
    let fieldName: string | undefined;
    if (lastChange.metadata) {
      try {
        const meta = JSON.parse(lastChange.metadata);
        fieldName = meta.field;
      } catch { /* fall through to regex */ }
    }
    if (!fieldName) {
      const fieldMatch = lastChange.summary?.match(/: (\w+) changed from/);
      fieldName = fieldMatch?.[1];
    }
    if (!fieldName) {
      return { ok: false, error: "Cannot undo: unable to determine which field was changed." };
    }
    if (!UNDO_FIELDS.includes(fieldName as typeof UNDO_FIELDS[number])) {
      return { ok: false, error: `Cannot undo: field '${fieldName}' is not a recognized project field.` };
    }
    await db
      .update(projects)
      .set({ [fieldName]: lastChange.previousValue || null, updatedAt: new Date() })
      .where(eq(projects.id, lastChange.projectId));
  }

  // Insert audit record for the undo
  await insertAuditRecord({
    idempotencyKey: idemKey,
    projectId: lastChange.projectId,
    clientId: lastChange.clientId,
    updatedBy,
    updateType: "undo",
    previousValue: lastChange.newValue,
    newValue: lastChange.previousValue,
    summary: `Undo: ${lastChange.summary}`,
  });

  return {
    ok: true,
    message: `Undone: reverted ${lastChange.updateType === "status-change" ? "status" : "field"} from "${lastChange.newValue}" back to "${lastChange.previousValue}".`,
    data: {
      undoneUpdateId: lastChange.id,
      revertedFrom: lastChange.newValue,
      revertedTo: lastChange.previousValue,
    },
  };
}
