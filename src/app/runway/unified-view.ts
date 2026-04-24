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
      // relationship. Silently demote to top-level — the condition is
      // surfaced to operators via `detectHierarchyDemotions` in
      // flags-detectors.ts (right-rail WARNING), which is visible on
      // the board instead of buried in server logs.
      if (parentItem && parentItem.parentProjectId && idsInAccount.has(parentItem.parentProjectId)) {
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

/**
 * Wrapper detection assumes `engagementType === "retainer"`. If a
 * non-retainer wrapper pattern is introduced (project-pack umbrella,
 * etc.), revisit this predicate.
 *
 * A retainer L1 is treated as a wrapper when ≥1 other L1 in the same
 * account has `parentProjectId` pointing at it. Standalone retainers
 * (Hopdoddy Digital Retainer shape) are NOT wrappers.
 */
function collectWrapperIdsInAccount(account: Account): Set<string> {
  const ids = new Set<string>();
  const referenced = new Set<string>();
  for (const item of account.items) {
    if (item.parentProjectId) referenced.add(item.parentProjectId);
  }
  for (const item of account.items) {
    if (item.engagementType !== "retainer") continue;
    if (referenced.has(item.id)) ids.add(item.id);
  }
  return ids;
}

/** `true` when the account contains at least one retainer wrapper. */
export function accountHasWrapper(account: Account): boolean {
  return collectWrapperIdsInAccount(account).size > 0;
}

/** Union of wrapper ids across every provided account. */
export function wrapperIds(accounts: Account[]): Set<string> {
  const ids = new Set<string>();
  for (const account of accounts) {
    for (const id of collectWrapperIdsInAccount(account)) ids.add(id);
  }
  return ids;
}

/**
 * Strip DayItemEntries whose `projectId` points at a retainer wrapper.
 * Defensive filter — wrappers are umbrella projects that should never
 * surface in Week view; their visible work lives on their child L1s'
 * milestones. Days that become empty after the filter are dropped.
 *
 * Returns new `DayItem` and `DayItem.items` arrays without mutating the
 * inputs, but `DayItemEntry` objects inside surviving days are reused
 * from the input (shallow copy). Callers that intend to mutate entries
 * should clone first; current callers (page.tsx) discard the source
 * arrays after filtering so aliasing is safe.
 */
export function filterWrapperDayItems(
  weekItems: DayItem[],
  accounts: Account[],
): DayItem[] {
  const wrappers = wrapperIds(accounts);
  if (wrappers.size === 0) return weekItems;
  const out: DayItem[] = [];
  for (const day of weekItems) {
    const filtered = day.items.filter(
      (entry) => !entry.projectId || !wrappers.has(entry.projectId),
    );
    if (filtered.length === 0) continue;
    out.push({ ...day, items: filtered });
  }
  return out;
}
