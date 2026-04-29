/**
 * Runway Flag Detectors — individual detection functions used by analyzeFlags
 */

import { createHash } from "crypto";
import type { Account, DayItem, DayItemEntry } from "@/app/runway/types";
import { parseISODate, toISODateString } from "@/app/runway/date-utils";
import type { FlagSeverity, RunwayFlag } from "./flags";

export function flagId(type: string, ...parts: string[]): string {
  return createHash("sha256")
    .update([type, ...parts].join("|"))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Statuses excluded from the staffing signal. Completed work is done;
 * blocked work cannot be performed, so neither counts toward capacity.
 * DIFFERENT from `CONTRACT_EXPIRED_ACTIVE_STATUSES` below — that's the
 * billing signal, which INCLUDES blocked. Do NOT unify.
 */
const RESOURCE_CONFLICT_EXCLUDED_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "blocked",
]);

/** Staffing-signal rolling window from today. Strict 10 calendar days. */
const RESOURCE_CONFLICT_WINDOW_DAYS = 10;

/**
 * Role-prefixed resources entry — mirrors the parser in
 * `operations-reads-retainers.ts` (kept inline here rather than imported
 * to avoid pulling the DB module graph into this pure-detectors module).
 */
const RESOURCES_ROLE_PREFIX = /^([A-Za-z]+):\s*(.+)$/;

/**
 * Split a `resources` field into distinct person names. Handles:
 *   - "CD: Lane, CW: Kathy"  → ["Lane", "Kathy"]
 *   - "Leslie"               → ["Leslie"]        (bare entry, role="Resource")
 *   - "Lane; Kathy\nLeslie"  → ["Lane", "Kathy", "Leslie"]
 *   - "" / null / "  "       → []
 * Returns normalized-lowercase names for stable dedup against `owner`.
 */
function parseResourceNames(resources: string | null | undefined): string[] {
  if (!resources) return [];
  const out: string[] = [];
  for (const raw of resources.split(/[,;\n]/)) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const match = RESOURCES_ROLE_PREFIX.exec(trimmed);
    const name = (match ? match[2] : trimmed).trim();
    if (name === "") continue;
    out.push(name.toLowerCase());
  }
  return out;
}

/**
 * Resource conflicts: person has 3+ UNIQUE deliverables across 2+ clients
 * within the rolling `RESOURCE_CONFLICT_WINDOW_DAYS` (10 days from today).
 *
 * **Locked decisions (2026-04-23):**
 *
 * 1. **Window — strict 10d rolling from today.** No Monday-Sunday bucketing.
 *    Work overlaps week boundaries in agency reality; a rolling window keeps
 *    cross-week load visible on a signal where chronological continuity
 *    matters more than calendar alignment.
 *
 * 2. **Both owner AND resources-field names count.** In agency work, the
 *    CD / designer / copywriter named in `resources` load a person's
 *    capacity the same as being the named owner. Early-exit only fires
 *    when BOTH fields are empty/unparseable.
 *
 * 3. **Per-person-per-item dedup across the window.** A 5-day item is
 *    ONE staffing load per person, not five. Counted via
 *    `Set<"{normalizedName}::{itemKey}">`. Same person appearing as
 *    owner AND in resources on the same item still counts once.
 */
export function detectResourceConflicts(
  thisWeek: DayItem[],
  upcoming: DayItem[]
): RunwayFlag[] {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + RESOURCE_CONFLICT_WINDOW_DAYS);

  // Person-level aggregates, keyed by normalized (lowercase-trim) name.
  // `displayName` preserves the first-seen casing for the flag title.
  const displayName = new Map<string, string>();
  const personAccounts = new Map<string, Set<string>>();
  const personItemKeys = new Map<string, Set<string>>();

  for (const day of [...thisWeek, ...upcoming]) {
    const dayDate = parseISODate(day.date);
    if (dayDate > cutoff) continue;

    for (const item of day.items) {
      if (item.status && RESOURCE_CONFLICT_EXCLUDED_STATUSES.has(item.status)) continue;

      // Build the unique set of people on this item from owner + resources.
      // Normalized names dedupe within-item (owner="Kathy" + resources="CD: Kathy"
      // collapses to one staffing touch for Kathy on this item).
      const peopleOnItem = new Map<string, string>(); // normalized -> display
      if (item.owner && item.owner.trim() !== "") {
        const ownerTrimmed = item.owner.trim();
        peopleOnItem.set(ownerTrimmed.toLowerCase(), ownerTrimmed);
      }
      for (const normalized of parseResourceNames(item.resources)) {
        if (peopleOnItem.has(normalized)) continue;
        // Preserve a readable display form — look up a non-lowercased
        // source if the resources field had one, else fall back to the
        // normalized form.
        peopleOnItem.set(normalized, recoverDisplayName(item.resources, normalized) ?? normalized);
      }
      if (peopleOnItem.size === 0) continue;

      // Per-item dedup key. When item.id is absent, fall back to the
      // same "account|title" composite used elsewhere (see detectPastEndL2s).
      const itemKey = item.id ?? `${item.account}|${item.title}`;

      for (const [normalized, display] of peopleOnItem) {
        if (!displayName.has(normalized)) displayName.set(normalized, display);

        if (!personAccounts.has(normalized)) personAccounts.set(normalized, new Set());
        personAccounts.get(normalized)!.add(item.account);

        if (!personItemKeys.has(normalized)) personItemKeys.set(normalized, new Set());
        personItemKeys.get(normalized)!.add(`${normalized}::${itemKey}`);
      }
    }
  }

  const flags: RunwayFlag[] = [];
  for (const [normalized, itemKeys] of personItemKeys) {
    const count = itemKeys.size;
    const accounts = personAccounts.get(normalized) ?? new Set();
    if (count >= 3 && accounts.size >= 2) {
      const display = displayName.get(normalized) ?? normalized;
      flags.push({
        id: flagId("resource-conflict", normalized),
        type: "resource-conflict",
        severity: "warning",
        title: `${display} has ${count} deliverables in ${RESOURCE_CONFLICT_WINDOW_DAYS} days`,
        detail: `Across ${accounts.size} clients: ${[...accounts].join(", ")}`,
        relatedPerson: display,
      });
    }
  }
  return flags;
}

/**
 * Recover a readable (cased) display form for a name parsed out of a
 * resources string. Scans the raw string entries and returns the first
 * segment whose lowercase form matches. Returns null when the name
 * doesn't appear in the input (e.g., upstream already normalized it).
 */
function recoverDisplayName(
  resources: string | null | undefined,
  normalized: string,
): string | null {
  if (!resources) return null;
  for (const raw of resources.split(/[,;\n]/)) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    const match = RESOURCES_ROLE_PREFIX.exec(trimmed);
    const candidate = (match ? match[2] : trimmed).trim();
    if (candidate.toLowerCase() === normalized) return candidate;
  }
  return null;
}

/**
 * Stale items: projects whose last write (`updatedAt`) is >= 14 days ago.
 * Critical at >= 30, warning at >= 14.
 *
 * Computes staleness from `updatedAt` rather than `projects.stale_days` —
 * that column has no writer since v3 and is always null in practice. Items
 * with a null `updatedAt` are skipped (unknown staleness, no signal).
 *
 * v4: excludes completed and on-hold projects — intentionally paused, not
 * stale. Uses Set for O(1) lookup.
 */
const STALE_EXCLUDED_STATUSES = new Set(["completed", "on-hold"]);

/**
 * Whole-day delta between an ISO timestamp and "now". Returns `null` when
 * `iso` is missing or unparseable — callers should treat that as "unknown,
 * do not flag".
 */
function daysSinceUpdatedAt(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)));
}

export function detectStaleItems(accounts: Account[]): RunwayFlag[] {
  const flags: RunwayFlag[] = [];
  for (const account of accounts) {
    for (const item of account.items) {
      if (STALE_EXCLUDED_STATUSES.has(item.status)) continue;
      const days = daysSinceUpdatedAt(item.updatedAt);
      if (days == null || days < 14) continue;
      const severity: FlagSeverity = days >= 30 ? "critical" : "warning";
      const waitingDetail = item.waitingOn
        ? ` -- waiting on ${item.waitingOn}`
        : "";
      flags.push({
        id: flagId("stale", account.slug, item.id),
        type: "stale",
        severity,
        title: `${item.title}${waitingDetail}`,
        detail: `${account.name} -- stale ${days} days`,
        relatedClient: account.slug,
        relatedPerson: item.waitingOn,
      });
    }
  }
  return flags;
}

/**
 * Upcoming deadlines: week items due today or tomorrow
 * with type "deadline" or "delivery".
 *
 * Fires off each item's own due date (`endDate ?? day.date`), not the
 * bucket key. After getStaleWeekItems / dashboard buckets shifted to be
 * startDate-keyed (Commit 4), `day.date` for a range task reflects the
 * kickoff day — but a deadline flag must fire on the day the work is
 * actually DUE, regardless of which bucket the item lives in.
 */
export function detectDeadlines(thisWeek: DayItem[]): RunwayFlag[] {
  const now = new Date();
  const todayStr = toISODateString(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toISODateString(tomorrow);

  const flags: RunwayFlag[] = [];
  for (const day of thisWeek) {
    for (const item of day.items) {
      if (item.type !== "deadline" && item.type !== "delivery") continue;
      const dueDate = item.endDate ?? day.date;
      if (dueDate !== todayStr && dueDate !== tomorrowStr) continue;
      const isToday = dueDate === todayStr;
      flags.push({
        id: flagId("deadline", dueDate, item.title, item.account),
        type: "deadline",
        severity: isToday ? "warning" : "info",
        title: `${item.account}: ${item.title}`,
        detail: isToday ? "Due today" : "Due tomorrow",
        relatedClient: item.account,
      });
    }
  }
  return flags;
}

/**
 * Bottlenecks: person appears as waitingOn on 3+ active items across clients.
 *
 * v4: only active projects count. Projects in terminal or paused states
 * (completed/blocked/on-hold) and stubs whose client is in awaiting-client
 * status are excluded — those are already flagged or dormant and should
 * not contribute to the bottleneck signal.
 */
const BOTTLENECK_EXCLUDED_STATUSES = new Set([
  "completed",
  "blocked",
  "on-hold",
  "awaiting-client",
]);

export function detectBottlenecks(accounts: Account[]): RunwayFlag[] {
  const waitingOnCounts = new Map<string, { count: number; clients: Set<string> }>();

  for (const account of accounts) {
    for (const item of account.items) {
      if (!item.waitingOn) continue;
      if (BOTTLENECK_EXCLUDED_STATUSES.has(item.status)) continue;
      const person = item.waitingOn;
      if (!waitingOnCounts.has(person)) {
        waitingOnCounts.set(person, { count: 0, clients: new Set() });
      }
      const entry = waitingOnCounts.get(person)!;
      entry.count++;
      entry.clients.add(account.name);
    }
  }

  const flags: RunwayFlag[] = [];
  for (const [person, { count, clients }] of waitingOnCounts) {
    if (count >= 3) {
      flags.push({
        id: flagId("bottleneck", person),
        type: "bottleneck",
        severity: "warning",
        title: `${person} has ${count} items in their inbox`,
        detail: `Across: ${[...clients].join(", ")}`,
        relatedPerson: person,
      });
    }
  }
  return flags;
}

/**
 * Past-end L2 items: L2 where `end_date < today AND status === 'in-progress'`.
 *
 * v4 convention §4 — surfaces items that the team has been actively working
 * on past their scheduled end. These need status review — either mark
 * completed, re-schedule, or flip to blocked. Severity scales with how far
 * past the end the item is to push the oldest drift to the top of the rail.
 *
 * Uses the same `DayItem[]` inputs as the other day-based detectors so the
 * caller only needs to supply this-week + upcoming (L2 boards).
 *
 * @see src/lib/runway/plate-summary.ts `pastEndRedNote` — per-item note
 *   rendered inline on cards. This detector rolls those conditions up for
 *   the global flags rail and the bot plate summary.
 */
export function detectPastEndL2s(
  thisWeek: DayItem[],
  upcoming: DayItem[]
): RunwayFlag[] {
  const now = new Date();
  const todayISO = toISODateString(now);
  const flags: RunwayFlag[] = [];
  // Dedupe by item id when available — same L2 may appear in thisWeek + upcoming
  // if boundaries overlap. Title+account fallback for items lacking id.
  const seen = new Set<string>();

  for (const day of [...thisWeek, ...upcoming]) {
    for (const item of day.items) {
      if (!isPastEndInProgress(item, todayISO)) continue;
      const dedupeKey = item.id ?? `${item.account}|${item.title}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const end = item.endDate ?? item.startDate ?? todayISO;
      const daysPast = daysBetweenISO(end, todayISO);
      // Critical when significantly past end (14+ days); warning otherwise.
      const severity: FlagSeverity = daysPast >= 14 ? "critical" : "warning";

      flags.push({
        id: flagId("past-end-l2", item.account, item.title, end),
        type: "past-end-l2",
        severity,
        title: `${item.account}: ${item.title}`,
        detail: `in-progress past end_date (${end}, ${daysPast} ${
          daysPast === 1 ? "day" : "days"
        } ago) — needs review`,
        relatedClient: item.account,
        ...(item.owner ? { relatedPerson: item.owner } : {}),
      });
    }
  }

  return flags;
}

/**
 * Predicate: does this day-item entry satisfy the past-end L2 condition?
 *
 * Exported for reuse by the bot plate summary — same criteria, same
 * behavior. Keep in sync with `plate-summary.pastEndRedNote` which adds
 * `daysSinceTouched` metadata for card rendering.
 */
export function isPastEndInProgress(
  item: DayItemEntry,
  todayISO: string
): boolean {
  if (item.status !== "in-progress") return false;
  const end = item.endDate ?? item.startDate ?? null;
  if (!end) return false;
  return end < todayISO;
}

/** Whole-day delta between two ISO dates (YYYY-MM-DD). Always non-negative. */
function daysBetweenISO(aISO: string, bISO: string): number {
  const a = Date.parse(aISO + "T00:00:00Z");
  const b = Date.parse(bISO + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / (24 * 60 * 60 * 1000)));
}

// ─── Billing-signal semantics (Phase C) ───────────────────
//
// "blocked" counts as active for the billing signal — dormant-but-alive
// work still counts against an expired contract. DIFFERENT from the
// staffing signal in detectResourceConflicts (Phase E), which EXCLUDES
// blocked. Do NOT unify — they are different frames.
//
// Exported so plate-summary's contractExpiredPills can share the same
// source of truth for the MCP/bot pill surface.
export const CONTRACT_EXPIRED_ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "in-production",
  "awaiting-client",
  "blocked",
  "not-started",
]);

export const RETAINER_RENEWAL_WINDOW_DAYS = 30;

/**
 * Retainer renewals: L1s with `engagementType='retainer'` whose
 * `contractEnd` lands within the 30-day window from today.
 *
 * Emits WARNING. Mirrors `retainerRenewalPills` in plate-summary but
 * returns the right-rail RunwayFlag shape.
 */
export function detectRetainerRenewals(accounts: Account[]): RunwayFlag[] {
  const todayISO = toISODateString(new Date());
  const flags: RunwayFlag[] = [];
  for (const account of accounts) {
    for (const item of account.items) {
      if (item.engagementType !== "retainer") continue;
      if (!item.contractEnd) continue;
      if (item.contractEnd < todayISO) continue;
      const daysOut = daysBetweenISO(todayISO, item.contractEnd);
      if (daysOut > RETAINER_RENEWAL_WINDOW_DAYS) continue;
      flags.push({
        id: flagId("retainer-renewal", account.slug, item.id),
        type: "retainer-renewal",
        severity: "warning",
        title: `Retainer renewal: ${account.name} / ${item.title}`,
        detail: `expires ${item.contractEnd} (${daysOut} ${daysOut === 1 ? "day" : "days"})`,
        relatedClient: account.slug,
      });
    }
  }
  return flags;
}

/**
 * Wrapper close-out nudge: a retainer wrapper whose `contractEnd`
 * has passed AND still sits in `in-production`. Signals that the
 * retainer should be wrapped up — set the wrapper to `completed`,
 * close out its children, or renew.
 *
 * Distinct from `detectRetainerRenewals` (pre-expiry) and
 * `detectContractExpired` (client-level). This is wrapper-level and
 * post-expiry. Only fires when the L1 IS functioning as a wrapper
 * (≥1 in-account child references it via parentProjectId) — a
 * standalone retainer with no children is handled by the client-level
 * `detectContractExpired` signal when the client itself is marked
 * expired.
 */
export function detectWrapperCloseOut(accounts: Account[]): RunwayFlag[] {
  const todayISO = toISODateString(new Date());
  const flags: RunwayFlag[] = [];
  for (const account of accounts) {
    const referenced = new Set<string>();
    for (const item of account.items) {
      if (item.parentProjectId) referenced.add(item.parentProjectId);
    }
    for (const item of account.items) {
      if (item.engagementType !== "retainer") continue;
      if (!referenced.has(item.id)) continue;
      if (item.status !== "in-production") continue;
      if (!item.contractEnd) continue;
      if (item.contractEnd >= todayISO) continue;
      flags.push({
        id: flagId("wrapper-close-out", account.slug, item.id),
        type: "wrapper-close-out",
        severity: "warning",
        title: `Close out retainer: ${account.name} / ${item.title}`,
        detail: `contract ended ${item.contractEnd} — mark completed or renew`,
        relatedClient: account.slug,
      });
    }
  }
  return flags;
}

/**
 * Hierarchy demotion (Llama #4): L1s that sit three-plus tiers deep in
 * the retainer wrapper tree. v4 convention is 2-tier max; anything
 * deeper is a structural bug the board should surface rather than hide
 * via a server-only `console.warn`.
 *
 * Predicate: for each L1 `p` with `parentProjectId` set, look up the
 * parent in the same account. If that parent ALSO has a
 * `parentProjectId` that resolves in-account, we have a 3-tier chain —
 * emit a flag on the grandchild `p`. Same-account resolution mirrors
 * `buildUnifiedAccounts` so the detector and the renderer agree on what
 * counts as "in the wrapper tree".
 */
export function detectHierarchyDemotions(accounts: Account[]): RunwayFlag[] {
  const flags: RunwayFlag[] = [];
  for (const account of accounts) {
    if (account.items.length === 0) continue;
    const byId = new Map<string, Account["items"][number]>();
    for (const item of account.items) byId.set(item.id, item);
    for (const item of account.items) {
      const parentId = item.parentProjectId;
      if (!parentId) continue;
      const parent = byId.get(parentId);
      if (!parent) continue;
      const grandparentId = parent.parentProjectId;
      if (!grandparentId) continue;
      if (!byId.has(grandparentId)) continue;
      flags.push({
        id: flagId("hierarchy-demotion", account.slug, item.id),
        type: "hierarchy-demotion",
        severity: "warning",
        title: `Hierarchy too deep: ${account.name} / ${item.title}`,
        detail: "v4 convention is 2-tier max — flatten or remove parent link",
        relatedClient: account.slug,
      });
    }
  }
  return flags;
}

/**
 * Contract expired: clients with `contractStatus='expired'` that still
 * have ≥1 L1 in an active-for-billing status. Uses
 * `CONTRACT_EXPIRED_ACTIVE_STATUSES` — includes `blocked` as dormant-
 * but-alive work still accrues against an expired contract.
 */
export function detectContractExpired(accounts: Account[]): RunwayFlag[] {
  const flags: RunwayFlag[] = [];
  for (const account of accounts) {
    if (account.contractStatus !== "expired") continue;
    const activeCount = account.items.reduce(
      (n, i) => (CONTRACT_EXPIRED_ACTIVE_STATUSES.has(i.status) ? n + 1 : n),
      0,
    );
    if (activeCount === 0) continue;
    flags.push({
      id: flagId("contract-expired", account.slug),
      type: "contract-expired",
      severity: "warning",
      title: `Contract expired: ${account.name}`,
      detail: `${activeCount} active L1${activeCount === 1 ? "" : "s"} still in flight`,
      relatedClient: account.slug,
    });
  }
  return flags;
}
