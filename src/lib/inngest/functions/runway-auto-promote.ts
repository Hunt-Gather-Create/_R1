/**
 * Inngest cron — auto-promote scheduled L2s into in-progress.
 *
 * Runs daily at 00:05 UTC. For every L2 (week item) whose `status` is
 * `'scheduled'` (or null, the legacy sentinel) AND whose date window
 * (`start_date` .. `end_date`) currently contains today, flip `status` to
 * `'in-progress'` and emit an audit row tagged with a date-scoped batch id.
 *
 * Issue #62 supersedes the display-only broadening from PR #104. The
 * dashboard's `filterInFlight` still accepts both `scheduled` and
 * `in-progress` in-window items as a safety net for any day the cron
 * misses, but the source of truth is now the column itself.
 *
 * Skip rules (mirror issue #62 spec):
 *   - `start_date IS NULL`        → cannot determine window
 *   - `start_date > today`        → not yet in window
 *   - `end_date < today`          → overdue; operator owns via Needs Update
 *   - status ∈ {blocked, at-risk} → operator-set; auto-promote does not override
 *   - status ∈ {completed, canceled, in-progress} → terminal or already promoted
 *
 * Idempotency: the WHERE clause filters on `status='scheduled' OR status IS NULL`
 * AND the date predicate, so once a row flips to `in-progress` it is no longer
 * a candidate on the next tick. Retries (low: 1) are safe; if Turso flakes
 * mid-batch, the next daily run reconverges.
 *
 * Batch id: `auto-promote-YYYY-MM-DD` (UTC), scoped through
 * `withBatchId(...)` so `insertAuditRecord` picks it up from
 * AsyncLocalStorage automatically without per-call boilerplate.
 */

import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

import { getRunwayDb } from "@/lib/db/runway";
import { weekItems } from "@/lib/db/runway-schema";
import { insertAuditRecord } from "@/lib/runway/operations-utils";
import { withBatchId } from "@/lib/runway/runway-als";

import { inngest } from "../client";

const PROMOTABLE_STATUSES = ["scheduled"] as const;

export const runwayAutoPromote = inngest.createFunction(
  {
    id: "runway-auto-promote-scheduled",
    name: "Runway: auto-promote scheduled L2s to in-progress",
    retries: 1,
  },
  { cron: "5 0 * * *" }, // 00:05 UTC daily
  async ({ step }) => {
    const today = new Date().toISOString().slice(0, 10);
    const batchId = `auto-promote-${today}`;

    const promotedCount = await step.run("promote-scheduled-in-window", async () => {
      const db = getRunwayDb();
      return await withBatchId(batchId, async () => {
        // Candidate predicate:
        //   (status='scheduled' OR status IS NULL)
        //   AND start_date IS NOT NULL
        //   AND start_date <= today
        //   AND (end_date IS NULL OR end_date >= today)
        const candidates = await db
          .select({
            id: weekItems.id,
            title: weekItems.title,
            projectId: weekItems.projectId,
            clientId: weekItems.clientId,
            status: weekItems.status,
            startDate: weekItems.startDate,
            endDate: weekItems.endDate,
          })
          .from(weekItems)
          .where(
            and(
              or(
                inArray(weekItems.status, [...PROMOTABLE_STATUSES]),
                isNull(weekItems.status),
              ),
              isNotNull(weekItems.startDate),
              lte(weekItems.startDate, today),
              or(
                isNull(weekItems.endDate),
                gte(weekItems.endDate, today),
              ),
            ),
          );

        let promoted = 0;
        for (const item of candidates) {
          await db.transaction(async (tx) => {
            await tx
              .update(weekItems)
              .set({ status: "in-progress", updatedAt: new Date() })
              .where(eq(weekItems.id, item.id));
            // Insert the audit row through the same transaction so the
            // status flip and its audit row are atomic. Pre-fix this used
            // the global db handle and could leave the row promoted with
            // no audit trail (or vice versa) on a mid-pair failure.
            await insertAuditRecord(
              {
                idempotencyKey: `auto-promote|${batchId}|${item.id}`,
                clientId: item.clientId ?? null,
                projectId: item.projectId ?? null,
                updatedBy: "auto-promote",
                updateType: "auto-promote-status",
                previousValue: item.status ?? null,
                newValue: "in-progress",
                summary: `Auto-promote: ${item.title} (date window contains ${today})`,
                metadata: JSON.stringify({
                  weekItemId: item.id,
                  field: "status",
                  trigger: "cron",
                  startDate: item.startDate,
                  endDate: item.endDate,
                }),
                // batchId pulled from ALS via insertAuditRecord — no explicit pass.
                source: null,
              },
              tx,
            );
          });
          promoted++;
        }
        return promoted;
      });
    });

    return { promotedCount, batchId };
  },
);
