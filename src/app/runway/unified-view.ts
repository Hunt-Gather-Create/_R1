/**
 * Unified Project View helpers — chunk 3 #1.
 *
 * Project View is a pivot of the same data the Week Of view consumes.
 * Rather than fetching L1s separately and losing the link to active L2s,
 * this module groups the combined data so By-Account displays each L1
 * with its L2 milestones inline. Same source, different shape.
 */

import type { Account, DayItem, DayItemEntry, TriageItem } from "./types";

export interface UnifiedAccount extends Account {
  items: UnifiedTriageItem[];
}

export interface UnifiedTriageItem extends TriageItem {
  /** L2 milestones whose `projectId` points at this L1, ordered by date. */
  milestones: DayItemEntry[];
}

/**
 * Build the unified shape by grouping week items under their parent L1
 * (projectId-keyed). Items without a parent L1 are dropped from this
 * view — they surface in Week Of only. Ordering within each project's
 * milestones is the order we receive them (already date-ASC from queries).
 */
export function buildUnifiedAccounts(
  accounts: Account[],
  weekItems: DayItem[]
): UnifiedAccount[] {
  // Flatten once. Each entry now carries projectId.
  const allEntries = weekItems.flatMap((day) => day.items);

  const byProjectId = new Map<string, DayItemEntry[]>();
  for (const entry of allEntries) {
    if (!entry.projectId) continue;
    const list = byProjectId.get(entry.projectId) ?? [];
    list.push(entry);
    byProjectId.set(entry.projectId, list);
  }

  return accounts.map((account) => ({
    ...account,
    items: account.items.map((p) => ({
      ...p,
      milestones: byProjectId.get(p.id) ?? [],
    })),
  }));
}
