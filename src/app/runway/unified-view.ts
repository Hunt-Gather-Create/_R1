/**
 * Unified Project View helpers — chunk 3 #1.
 *
 * Project View is a pivot of the same data the Week Of view consumes.
 * Rather than fetching L1s separately and losing the link to active L2s,
 * this module groups the combined data so By-Account displays each L1
 * with its L2 milestones inline. Same source, different shape.
 *
 * PR #88 Chunk F adds retainer-wrapper nesting: when an L1 has
 * `parentProjectId` set, it is attached as a child of its wrapper and
 * filtered out of the account's top-level items. Wrappers render a
 * 3-level hierarchy (wrapper -> children -> L2s).
 */

import type { Account, DayItem, DayItemEntry, TriageItem } from "./types";

export interface UnifiedAccount extends Account {
  items: UnifiedTriageItem[];
}

export interface UnifiedTriageItem extends TriageItem {
  /** L2 milestones whose `projectId` points at this L1, ordered by date. */
  milestones: DayItemEntry[];
  /**
   * Child L1s whose `parentProjectId` points at this wrapper. Present only
   * on retainer wrappers; leaves omit the field (or carry []).
   * v4 convention (2026-04-21 / PR #88 Chunk F).
   */
  children?: UnifiedTriageItem[];
}

/**
 * Build the unified shape by grouping week items under their parent L1
 * (projectId-keyed). Items without a parent L1 are dropped from this
 * view — they surface in Week Of only. Ordering within each project's
 * milestones is the order we receive them (already date-ASC from queries).
 *
 * After milestone attachment, nest retainer-wrapper children under their
 * parent L1 via `parentProjectId`. Children are removed from the
 * account's top-level item list so they render only inside the wrapper.
 * v4 is 2-tier max — a grandparent (child whose `parentProjectId` points
 * at another child) is logged as a warning but treated as top-level to
 * avoid infinite recursion; it still renders, just not nested.
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

  return accounts.map((account) => {
    // Step 1: enrich every L1 with its milestone list.
    const enriched: UnifiedTriageItem[] = account.items.map((p) => ({
      ...p,
      milestones: byProjectId.get(p.id) ?? [],
    }));

    // Step 2: group by parentProjectId. Any L1 with a parentProjectId
    // whose value matches another L1's id in this account becomes a child
    // of that L1 and is hidden from the top-level list.
    const idsInAccount = new Set(enriched.map((i) => i.id));
    const childrenByParent = new Map<string, UnifiedTriageItem[]>();
    const childIds = new Set<string>();
    for (const item of enriched) {
      const pid = item.parentProjectId;
      if (!pid) continue;
      if (!idsInAccount.has(pid)) {
        // Wrapper is on a different account / missing. Treat as top-level
        // to avoid orphaning the card. Silent fall-through.
        continue;
      }
      const parentItem = enriched.find((i) => i.id === pid);
      // v4 is 2-tier max. If the supposed parent itself has a
      // parentProjectId set in-account, we'd be creating a grandparent
      // relationship. Log and demote to top-level.
      if (parentItem && parentItem.parentProjectId && idsInAccount.has(parentItem.parentProjectId)) {
        if (typeof console !== "undefined") {
          console.warn(
            `[runway] grandparent detected in retainer wrapper tree; rendering ${item.id} as top-level (v4 is 2-tier max)`,
          );
        }
        continue;
      }
      const list = childrenByParent.get(pid) ?? [];
      list.push(item);
      childrenByParent.set(pid, list);
      childIds.add(item.id);
    }

    // Step 3: attach children to each wrapper; drop children from the top
    // level. Preserve original order within both levels (parent L1s in
    // original sort order; children in original sort order within each
    // group — same ordering the DB gives us via sortOrder ASC).
    const items: UnifiedTriageItem[] = enriched
      .filter((i) => !childIds.has(i.id))
      .map((i) => {
        const children = childrenByParent.get(i.id);
        if (!children || children.length === 0) return i;
        return { ...i, children };
      });

    return { ...account, items };
  });
}
