/**
 * Reader and resolver for the sheet-sync review queue.
 *
 * Resolving a row only marks the queue row. An approved row reaches prod
 * later through the data-integrity pipeline, per D-10, so nothing here
 * writes any other table. Rows are never deleted.
 */

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getRunwayDb } from "@/lib/db/runway";
import { applyReviewQueue } from "@/lib/db/runway-schema";
import { describeReviewPayload, type ReviewPayloadDescription } from "./review-queue-describe";

type QueueExecutor = Pick<ReturnType<typeof getRunwayDb>, "select" | "update">;

export type ReviewQueueStatus = "approved" | "dismissed";

export interface ReviewQueueItem extends ReviewPayloadDescription {
  id: string;
  runId: string;
  createdAt: Date;
  op: string | null;
  status: ReviewQueueStatus | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  payloadUnreadable: boolean;
}

export type ResolveReviewQueueResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "already-resolved" };

function parsePayload(json: string): { op: string; params: Record<string, unknown>; reason: string } | null {
  try {
    const p = JSON.parse(json) as Record<string, unknown>;
    if (!p || typeof p !== "object" || typeof p.op !== "string") return null;
    const params = p.params && typeof p.params === "object" ? (p.params as Record<string, unknown>) : {};
    return { op: p.op, params, reason: typeof p.reason === "string" ? p.reason : "" };
  } catch {
    return null;
  }
}

/** Pending rows first, then resolved; newest first within each group. */
export async function listReviewQueue(db: QueueExecutor = getRunwayDb()): Promise<ReviewQueueItem[]> {
  const rows = await db
    .select()
    .from(applyReviewQueue)
    .orderBy(asc(sql`${applyReviewQueue.status} IS NOT NULL`), desc(applyReviewQueue.createdAt));

  return rows.map((row) => {
    const payload = parsePayload(row.payloadJson);
    const described = payload
      ? describeReviewPayload(payload)
      : { summary: "This held change could not be read", reason: "", fields: [] };
    return {
      ...described,
      id: row.id,
      runId: row.runId,
      createdAt: row.createdAt,
      op: payload?.op ?? null,
      status: row.status ?? null,
      resolvedAt: row.resolvedAt ?? null,
      resolvedBy: row.resolvedBy ?? null,
      payloadUnreadable: payload === null,
    };
  });
}

/**
 * Marks one pending row approved or dismissed. The status IS NULL guard sits
 * in the UPDATE itself, so two clicks racing cannot both win.
 */
export async function resolveReviewQueueRow(
  db: QueueExecutor,
  input: { id: string; status: ReviewQueueStatus; resolvedBy: string; now?: Date },
): Promise<ResolveReviewQueueResult> {
  const updated = await db
    .update(applyReviewQueue)
    .set({ status: input.status, resolvedAt: input.now ?? new Date(), resolvedBy: input.resolvedBy })
    .where(and(eq(applyReviewQueue.id, input.id), isNull(applyReviewQueue.status)))
    .returning({ id: applyReviewQueue.id });
  if (updated.length > 0) return { ok: true };

  const existing = await db
    .select({ id: applyReviewQueue.id })
    .from(applyReviewQueue)
    .where(eq(applyReviewQueue.id, input.id));
  return { ok: false, reason: existing.length > 0 ? "already-resolved" : "not-found" };
}
