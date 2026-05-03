/**
 * Wave 14 / pre-plan v7 §A4 — intercept-miss alert via the `auditObserver`
 * listener pattern (NOT inline grep).
 *
 * Operations-layer write helpers (`addProject`, `createWeekItem`,
 * `createTeamMember`, etc.) accept an optional `auditObserver` callback that
 * fires after every audit insert with a structured `AuditEvent`. Production
 * code wires the observer returned by `createInterceptMissObserver()` so we
 * detect when a `bot-direct` create_* tool slipped past the modal gate while
 * `MODAL_INTERCEPT_ENABLED=true` — that's the regression the modal layer is
 * supposed to prevent.
 *
 * Detection rules (all must hold to fire the warn):
 *   1. `MODAL_INTERCEPT_ENABLED=true`
 *   2. `event.source === "bot-direct"` — non-modal bot LLM tool call
 *   3. `event.entityType ∈ ALLOWLISTED_ENTITY_TYPES` — modal-routed surface
 *   4. `updatedBy` carries a `slack:UID:` prefix (otherwise we can't scope
 *       the lookup to a specific user)
 *   5. No `bot_modal_proposals` row with `status='submitted'` exists for
 *       that Slack user in the last 5 minutes
 *
 * Original spec scoped the lookup by `user_slack_id + channel_id +
 * intent_group_id`. The `AuditEvent` shape today (Builder 0b output) carries
 * neither `channelId` nor `intentGroupId`, so this implementation degrades to
 * `user_slack_id + last 5 min`. That's still a useful regression alarm; the
 * follow-up to enrich AuditEvent with channel/intent context is tracked in
 * the Wave 14 handoff doc.
 *
 * The observer is fire-and-forget on the write path. Database failures are
 * caught and logged via `console.error` — they must NEVER throw out and
 * crash the write transaction.
 *
 * Wiring (Phase 2 follow-up): Builder 7 owns `bot-tools.ts` and is best
 * positioned to register `createInterceptMissObserver()` into the bot-direct
 * fallback path; this module only ships the factory. See
 * `wave-14-complete-handoff.md` open follow-ups.
 */

import { and, eq, gt } from "drizzle-orm";

import { getRunwayDb } from "@/lib/db/runway";
import { botModalProposals } from "@/lib/db/runway-schema";
import { isModalInterceptEnabled } from "@/lib/feature-flags";
import type { AuditEvent } from "@/lib/runway/operations-utils";

// ── Constants ────────────────────────────────────────────

/**
 * Entity types that the modal intercept layer is responsible for. Matches
 * `INTERCEPT_ALLOWLIST` in operations-utils (`create_project`,
 * `create_week_item`, `create_team_member`) but expressed at the entity
 * granularity that AuditEvent actually carries.
 */
const ALLOWLISTED_ENTITY_TYPES: ReadonlySet<NonNullable<AuditEvent["entityType"]>> = new Set([
  "project",
  "week_item",
  "team_member",
]);

const LOOKBACK_MS = 5 * 60 * 1000;
const LOG_TAG = "[intercept-miss]";

/**
 * Parse `slack:UID:bot|modal[-edit]` -> `UID`. Returns null for any updatedBy
 * format that doesn't carry a Slack user id (migration / cli / etc.) so the
 * observer can skip cleanly rather than fire false-positive alerts.
 */
function extractSlackUserId(updatedBy: string): string | null {
  const m = /^slack:([^:]+):/.exec(updatedBy);
  return m?.[1] ?? null;
}

// ── Observer ─────────────────────────────────────────────

export type AuditObserver = (event: AuditEvent) => Promise<void> | void;

/**
 * Build an `AuditObserver` callback suitable for passing to operations-layer
 * write helpers. Returns a closure so each registration site can keep its own
 * observer reference (and tests can pass a fresh closure with a clean DB
 * mock).
 *
 * Production registers this observer on the bot-direct create path (Phase 2
 * follow-up); modal-routed paths never need it because their `source` value
 * already excludes them from the alert.
 */
export function createInterceptMissObserver(): AuditObserver {
  return async (event: AuditEvent): Promise<void> => {
    // Rule 1: feature flag must be on. Cheaper than a DB hit, so check first.
    if (!isModalInterceptEnabled()) return;

    // Rule 2: only bot-direct writes can be intercept-misses. Modal-routed
    // sources, mcp, migration, cli, and pre-modal-era null all skip.
    if (event.source !== "bot-direct") return;

    // Rule 3: entity must be modal-routed. `pipeline_item` and any future
    // surface outside the allowlist short-circuits here.
    if (!event.entityType || !ALLOWLISTED_ENTITY_TYPES.has(event.entityType)) {
      return;
    }

    // Rule 4: updatedBy must carry a Slack user id we can scope the lookup
    // to. If the bot-direct write came from a non-Slack surface (shouldn't
    // happen in practice, but defensive), skip rather than alert wrongly.
    const userSlackId = extractSlackUserId(event.updatedBy);
    if (!userSlackId) return;

    // Rule 5: no recent `submitted` proposal for this user in the last 5 min.
    // Wrap the DB call so a Turso outage can't crash the write path that
    // triggered the observer.
    try {
      const db = getRunwayDb();
      const cutoff = new Date(Date.now() - LOOKBACK_MS);
      const recentSubmitted = await db
        .select({ id: botModalProposals.id })
        .from(botModalProposals)
        .where(
          and(
            eq(botModalProposals.userSlackId, userSlackId),
            eq(botModalProposals.status, "submitted"),
            gt(botModalProposals.createdAt, cutoff),
          ),
        )
        .limit(1);

      if (recentSubmitted.length > 0) {
        // The user submitted a modal in the last 5 min — this bot-direct
        // write is plausibly the resulting operations-layer call from the
        // modal submit-handler chain (or an unrelated but legitimate
        // follow-up). Either way, suppress the alert.
        return;
      }

      console.warn(LOG_TAG, {
        message:
          "bot-direct create write hit ops layer without preceding submitted modal proposal",
        source: event.source,
        entityType: event.entityType,
        entityId: event.entityId,
        userSlackId,
      });
    } catch (err) {
      console.error(LOG_TAG, {
        message: "intercept-miss lookup failed; alert suppressed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
