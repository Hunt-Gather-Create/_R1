/**
 * Inngest cron — sweep expired Slack modal proposals.
 *
 * Runs every 15 minutes against the Runway DB and performs two passes:
 *
 *   1. Mark `bot_modal_proposals` rows whose `status='pending'` and
 *      `expires_at < now()` as `expired`, with `status_reason='TTL elapsed'`.
 *      This is the canonical TTL enforcement path for unresolved modal
 *      proposals (per pre-plan v7 §"Wave 12").
 *
 *   2. Delete rows in any terminal status (`submitted` | `cancelled` |
 *      `expired` | `failed`) whose `created_at` is older than 24 hours.
 *      This is a stale-row reaper that keeps the proposals table small;
 *      the 24-hour delay is intentional so submitted rows remain
 *      observable in the Inngest run history and dashboards.
 *
 * Both passes are wrapped in named `step.run(...)` blocks so Inngest can
 * checkpoint each independently and retry only the failed step. Retries are
 * intentionally low (1) — a transient Turso failure is acceptable; the next
 * cron tick (≤15 min later) will reconverge.
 *
 * Idempotency: the WHERE clauses are self-limiting — a row only flips
 * `pending → expired` once, and once deleted, can't be re-deleted. Re-runs
 * against an already-converged DB return `{ expiredCount: 0, deletedCount: 0 }`.
 */

import { and, eq, inArray, lt } from "drizzle-orm";

import { getRunwayDb } from "@/lib/db/runway";
import { botModalProposals } from "@/lib/db/runway-schema";

import { inngest } from "../client";

const TERMINAL_STATUSES = ["submitted", "cancelled", "expired", "failed"] as const;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const sweepExpiredProposals = inngest.createFunction(
  {
    id: "sweep-expired-proposals",
    name: "Sweep expired Slack modal proposals",
    retries: 1,
  },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const expiredCount = await step.run("mark-expired", async () => {
      const db = getRunwayDb();
      const now = new Date();
      const result = await db
        .update(botModalProposals)
        .set({ status: "expired", statusReason: "TTL elapsed" })
        .where(
          and(
            eq(botModalProposals.status, "pending"),
            lt(botModalProposals.expiresAt, now)
          )
        )
        .returning({ id: botModalProposals.id });
      return result.length;
    });

    const deletedCount = await step.run("delete-stale-terminal", async () => {
      const db = getRunwayDb();
      const cutoff = new Date(Date.now() - TWENTY_FOUR_HOURS_MS);
      const result = await db
        .delete(botModalProposals)
        .where(
          and(
            inArray(botModalProposals.status, [...TERMINAL_STATUSES]),
            lt(botModalProposals.createdAt, cutoff)
          )
        )
        .returning({ id: botModalProposals.id });
      return result.length;
    });

    return { expiredCount, deletedCount };
  }
);
