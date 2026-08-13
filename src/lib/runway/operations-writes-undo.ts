/**
 * Runway Write Operations — undo last change
 *
 * Reverts the most recent status-change or field-change made by a user.
 *
 * Race fix (#26): the find-last + apply-undo pair runs inside a single
 * db.transaction so a concurrent writer cannot land a new audit row between
 * the read and the write. Plus an explicit stale-target detection that
 * refuses to clobber a newer change to the same {project, field} — the
 * user gets a readable copy instead of an opaque idempotency mismatch.
 */

import { getRunwayDb } from "@/lib/db/runway";
import { projects, updates } from "@/lib/db/runway-schema";
import { and, eq, desc, gt, or } from "drizzle-orm";
import {
  UNDO_FIELDS,
  generateIdempotencyKey,
  checkIdempotency,
  insertAuditRecord,
  validateParentProjectIdAssignment,
  formatL2NeverRetainerError,
} from "./operations-utils";
import type { MutationResponse } from "./mutation-response";

const UNDOABLE_TYPES = ["status-change", "field-change"];
const MAX_UNDO_SCAN = 50;

/**
 * User-visible copy for the stale-target case (#26). Replaces the prior
 * opaque "idempotency mismatch" message that surfaced when a concurrent
 * writer overwrote the change we were trying to undo.
 */
const STALE_TARGET_MESSAGE =
  "This change has been modified since you last saw it. Refresh to see the latest state.";

interface AuditLike {
  updateType: string | null;
  metadata: string | null;
  summary: string | null;
}

/**
 * Resolve which project field a given audit row touches, for stale-target
 * matching. status-change rows are status by definition; field-change rows
 * carry the field name in metadata (new path) or the summary string
 * (pre-migration rows).
 */
function extractFieldName(row: AuditLike): string | null {
  if (row.updateType === "status-change") return "status";
  if (row.updateType !== "field-change") return null;
  if (row.metadata) {
    try {
      const meta = JSON.parse(row.metadata);
      // Length check preserves the pre-hoist falsy-fallthrough semantics:
      // empty-string field metadata falls back to the summary regex.
      if (typeof meta?.field === "string" && meta.field.length > 0) {
        return meta.field;
      }
    } catch {
      /* fall through to summary regex */
    }
  }
  const fieldMatch = row.summary?.match(/: (\w+) changed from/);
  return fieldMatch?.[1] ?? null;
}

export async function undoLastChange(params: {
  updatedBy: string;
}): Promise<
  MutationResponse<{
    undoneUpdateId: string;
    revertedFrom: string | null;
    revertedTo: string | null;
  }>
> {
  const { updatedBy } = params;
  const db = getRunwayDb();

  return db.transaction(async (tx) => {
    // Find the most recent undoable change by this user (bounded scan).
    const recentUpdates = await tx
      .select()
      .from(updates)
      .where(eq(updates.updatedBy, updatedBy))
      .orderBy(desc(updates.createdAt), desc(updates.id))
      .limit(MAX_UNDO_SCAN);

    // Walk the list, skipping records that have already been undone.
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

    if (!lastChange.projectId) {
      return {
        ok: false,
        error: "Cannot undo: missing project reference.",
      };
    }

    // #26 stale-target detection: any newer audit row touching the same
    // {project, field} means our apply would clobber a more recent state.
    // Refuse and tell the user to refresh.
    //
    // `createdAt` is integer-seconds — same-second writes need an id-tiebreak
    // to be detected. Mirrors the recentUpdates query's `desc(createdAt),
    // desc(id)` ordering convention. Without the tiebreak (gt-on-createdAt
    // alone) a competing writer landing in the same second slips the gate.
    const lastField = extractFieldName(lastChange);
    if (lastField) {
      const newerSameProject = await tx
        .select({
          id: updates.id,
          updateType: updates.updateType,
          metadata: updates.metadata,
          summary: updates.summary,
        })
        .from(updates)
        .where(
          and(
            eq(updates.projectId, lastChange.projectId),
            or(
              gt(updates.createdAt, lastChange.createdAt),
              and(
                eq(updates.createdAt, lastChange.createdAt),
                gt(updates.id, lastChange.id),
              ),
            ),
          ),
        );
      const staleClobber = newerSameProject.some(
        (row) => extractFieldName(row) === lastField,
      );
      if (staleClobber) {
        return { ok: false, error: STALE_TARGET_MESSAGE };
      }
    }

    const idemKey = generateIdempotencyKey("undo", lastChange.id, updatedBy);

    // Determine what to revert (null previousValue is valid — means "set back to null").
    if (lastChange.updateType === "status-change") {
      await tx
        .update(projects)
        .set({ status: lastChange.previousValue ?? "not-started", updatedAt: new Date() })
        .where(eq(projects.id, lastChange.projectId));
    } else if (lastChange.updateType === "field-change") {
      const fieldName = extractFieldName(lastChange);
      if (!fieldName) {
        return { ok: false, error: "Cannot undo: unable to determine which field was changed." };
      }
      if (!UNDO_FIELDS.includes(fieldName as typeof UNDO_FIELDS[number])) {
        return { ok: false, error: `Cannot undo: field '${fieldName}' is not a recognized project field.` };
      }
      // Delta A (2026-07-26): undo re-applies previousValue raw, so the
      // nesting invariants must be revalidated here. The #26 stale gate is
      // same-field only — a cross-field sequence (e.g. retype retainer →
      // project, then nest, then undo the retype) would otherwise
      // reconstruct a forbidden nested-retainer state.
      const restoredValue = lastChange.previousValue || null;
      if (fieldName === "parentProjectId" && restoredValue !== null) {
        const childRows = await tx
          .select({ clientId: projects.clientId })
          .from(projects)
          .where(eq(projects.id, lastChange.projectId))
          .limit(1);
        if (childRows[0]) {
          const v = await validateParentProjectIdAssignment(tx, {
            childId: lastChange.projectId,
            childClientId: childRows[0].clientId,
            newParentId: restoredValue,
          });
          if (!v.ok) return { ok: false, error: `Cannot undo: ${v.error}` };
        }
      }
      if (fieldName === "engagementType" && restoredValue === "retainer") {
        const rows = await tx
          .select({ parentProjectId: projects.parentProjectId })
          .from(projects)
          .where(eq(projects.id, lastChange.projectId))
          .limit(1);
        if (rows[0]?.parentProjectId != null) {
          return {
            ok: false,
            error: `Cannot undo: ${formatL2NeverRetainerError(lastChange.projectId)}`,
          };
        }
      }
      await tx
        .update(projects)
        .set({ [fieldName]: lastChange.previousValue || null, updatedAt: new Date() })
        .where(eq(projects.id, lastChange.projectId));
    }

    // Insert audit record for the undo.
    await insertAuditRecord(
      {
        idempotencyKey: idemKey,
        projectId: lastChange.projectId,
        clientId: lastChange.clientId,
        updatedBy,
        updateType: "undo",
        previousValue: lastChange.newValue,
        newValue: lastChange.previousValue,
        summary: `Undo: ${lastChange.summary}`,
      },
      tx,
    );

    return {
      ok: true,
      message: `Undone: reverted ${lastChange.updateType === "status-change" ? "status" : "field"} from "${lastChange.newValue}" back to "${lastChange.previousValue}".`,
      data: {
        undoneUpdateId: lastChange.id,
        revertedFrom: lastChange.newValue,
        revertedTo: lastChange.previousValue,
      },
    };
  });
}
