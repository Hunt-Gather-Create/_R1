/**
 * Plate summary helpers — soft flags surfaced on the Runway board.
 *
 * Chunk 3 items #3, #4, #5:
 *  - Past-end L2 red-section inline note
 *  - Retainer renewal soft pill (30-day window)
 *  - Contract-expired soft pill
 *
 * These are pure functions over UI types so they can be exercised by
 * component tests without touching the DB. See runway-v4-convention.md
 * §"Convention-driven behaviors §4-6" for the authoritative spec.
 */

import type { Account, DayItemEntry, TriageItem } from "@/app/runway/types";

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETAINER_RENEWAL_WINDOW_DAYS = 30;

/** ISO `YYYY-MM-DD` for a given Date. UTC-based to avoid local-time drift. */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Number of whole days between two ISO dates. Assumes valid `YYYY-MM-DD`. */
export function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO + "T00:00:00Z");
  const b = Date.parse(bISO + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

// ── #3: Past-end L2 red note ─────────────────────────────

/**
 * Evaluate whether a day-item entry should display the past-end red note.
 *
 * Condition (v4): `end_date < today AND status === 'in-progress'`.
 * Also used when end_date is null but start_date < today for single-day
 * in-progress items that drifted past their date.
 *
 * Returns `{ shouldFlag: true, daysSinceTouched }` when applicable; else null.
 */
export function pastEndRedNote(
  item: DayItemEntry,
  nowISO: string,
  nowMs: number
): { daysSinceTouched: number } | null {
  if (item.status !== "in-progress") return null;
  const end = item.endDate ?? item.startDate ?? null;
  if (!end) return null;
  if (end >= nowISO) return null;
  // Days since last write to the row — defaults to 0 when unknown.
  const daysSinceTouched = item.updatedAtMs
    ? Math.max(0, Math.round((nowMs - item.updatedAtMs) / DAY_MS))
    : 0;
  return { daysSinceTouched };
}

/** Prebuilt copy for the inline note — matches spec in chunk-3 prompt. */
export function pastEndNoteText(daysSinceTouched: number): string {
  return `status unchanged past end_date — needs review, last touched ${daysSinceTouched} ${
    daysSinceTouched === 1 ? "day" : "days"
  } ago`;
}

// ── #4: Retainer renewal pill ────────────────────────────

export interface RetainerRenewalPill {
  projectName: string;
  contractEnd: string; // ISO date
  daysOut: number;
}

/**
 * Detect retainer renewals coming due within the 30-day window.
 *
 * Applies only to L1s with `engagement_type='retainer'` that have a
 * non-null `contract_end` on or after today and within `windowDays`.
 */
export function retainerRenewalPills(
  items: TriageItem[],
  nowISO: string,
  windowDays = RETAINER_RENEWAL_WINDOW_DAYS
): RetainerRenewalPill[] {
  const pills: RetainerRenewalPill[] = [];
  for (const item of items) {
    if (item.engagementType !== "retainer") continue;
    if (!item.contractEnd) continue;
    if (item.contractEnd < nowISO) continue;
    const daysOut = daysBetween(nowISO, item.contractEnd);
    if (daysOut > windowDays) continue;
    pills.push({ projectName: item.title, contractEnd: item.contractEnd, daysOut });
  }
  return pills;
}

/** Inline copy matching spec: `Renewal: {projectName} expires {date}`. */
export function retainerPillText(pill: RetainerRenewalPill): string {
  return `Renewal: ${pill.projectName} expires ${pill.contractEnd}`;
}

// ── #5: Contract-expired pill ────────────────────────────

export interface ContractExpiredPill {
  clientName: string;
}

/**
 * Detect clients whose contract has expired while an active L1 still exists
 * (status in the active set). Matches `getPersonWorkload` contractExpired
 * semantics but scoped to the full account list for the global board.
 */
const ACTIVE_L1_STATUSES = new Set(["in-production", "not-started"]);

export function contractExpiredPills(accounts: Account[]): ContractExpiredPill[] {
  const pills: ContractExpiredPill[] = [];
  for (const account of accounts) {
    if (account.contractStatus !== "expired") continue;
    const hasActive = account.items.some(
      (i) => ACTIVE_L1_STATUSES.has(i.status) || i.status === "blocked"
    );
    if (!hasActive) continue;
    pills.push({ clientName: account.name });
  }
  return pills;
}

export function contractExpiredPillText(pill: ContractExpiredPill): string {
  return `Contract expired: ${pill.clientName}`;
}

// ── #6: In Flight filter ─────────────────────────────────

/**
 * Return only the items that are actively "in flight" today:
 *  - `status === 'in-progress'` AND
 *  - today is between `start_date` and `end_date` (inclusive). `end_date`
 *    null is treated as same as `start_date` (single-day item).
 *
 * Does NOT mutate its input. Used by the Week Of In Flight toggle section.
 */
export function filterInFlight<T extends { status?: string | null; startDate?: string | null; endDate?: string | null }>(
  items: T[],
  nowISO: string
): T[] {
  return items.filter((item) => {
    if (item.status !== "in-progress") return false;
    const start = item.startDate;
    if (!start) return false;
    const end = item.endDate ?? start;
    return start <= nowISO && nowISO <= end;
  });
}
