/**
 * Active-status filter for the Gantt rundown.
 *
 * Operator-locked rules (Track 3 Wave 2):
 *
 *   hideL1(l1)            = l1.status ∈ {completed, canceled}
 *   hideWrapper(w, kids)  = all(hideL1(k) for k in kids)
 *                           AND all(wi.status ∈ {completed, canceled}
 *                                   for wi in w.directWeekItems)
 *   hideClient(c)         = no wrapper or L1 survives  (caller's concern;
 *                           this module returns sections.length === 0 when
 *                           the whole rundown filters out)
 *
 * Edge cases:
 *  - L1 with 0 weekItems → NOT hidden (data-integrity surface).
 *  - L1 with all weekItems completed but L1.status NOT terminal →
 *    NOT hidden + flagged via isReadyToClose() as "ready to close?".
 *  - Wrapper with no kids and no orphans → NOT hidden (degenerate).
 *  - Wrapper-level: at the rundown layer, orphan weekItem statuses are
 *    NOT carried in `RawData.orphanWeekItems` (only id+title). Therefore
 *    `filterActiveRundown` is conservative — any orphans present keep the
 *    wrapper visible. Callers with full WeekItemRow data can still use
 *    `isWrapperHidden()` directly for precise evaluation.
 *  - "canceled" is treated identically to "completed" for hide rules.
 *  - WeekItem `status === null` is treated as "scheduled" (non-terminal).
 */

import type {
  ClientRundownData,
  ProjectRow,
  RundownSection,
  WeekItemRow,
} from "./types";

// Terminal status values used for the hide rule on both L1 projects and
// weekItems. Operator-locked: `completed` and `canceled` only.
const TERMINAL_STATUSES = new Set<string>(["completed", "canceled"]);

/**
 * Returns true if the L1 should be hidden from the active view.
 * Hide rule: l1.status ∈ {completed, canceled}.
 *
 * Note: L1 with 0 weekItems is NOT considered here — that's a row-count
 * concern, not a status concern. This function only evaluates the L1's
 * own status field.
 */
export function isL1Hidden(l1: ProjectRow): boolean {
  if (l1.status == null) return false;
  return TERMINAL_STATUSES.has(l1.status);
}

/**
 * Returns true if the wrapper should be hidden.
 * Hide rule: all child L1s hidden AND every direct weekItem in
 * {completed, canceled}.
 *
 * Degenerate case: a wrapper with no kids and no orphans is NOT hidden —
 * `every` over an empty array is true, but the AND'd intent is "everything
 * present is terminal", which is vacuously true with no signal at all.
 * We surface that as "not hidden" so a hollow wrapper remains visible as
 * a data-integrity nudge.
 */
export function isWrapperHidden(
  _wrapper: ProjectRow,
  childL1s: ProjectRow[],
  directWeekItems: WeekItemRow[],
): boolean {
  // Nothing to hide — degenerate empty wrapper stays visible.
  if (childL1s.length === 0 && directWeekItems.length === 0) return false;

  const allChildrenHidden = childL1s.every((c) => isL1Hidden(c));
  if (!allChildrenHidden) return false;

  // Orphan weekItems: every one must be terminal. Null status counts as
  // scheduled (non-terminal), so a null-status orphan keeps the wrapper.
  const allOrphansTerminal = directWeekItems.every(
    (wi) => wi.status != null && TERMINAL_STATUSES.has(wi.status),
  );
  return allOrphansTerminal;
}

/**
 * Returns true if this L1 has all its weekItems completed BUT the L1
 * itself is not yet marked completed/canceled. Surfaces a "ready to
 * close?" indicator in views to nudge close-out.
 *
 * Returns false when:
 *  - L1 has 0 weekItems (no rollup signal yet)
 *  - Any weekItem is non-completed (including null = scheduled and
 *    canceled — only literal "completed" counts as completion)
 *  - L1 itself is already in {completed, canceled}
 */
export function isReadyToClose(
  l1: ProjectRow,
  weekItems: WeekItemRow[],
): boolean {
  if (weekItems.length === 0) return false;
  if (l1.status != null && TERMINAL_STATUSES.has(l1.status)) return false;
  return weekItems.every((wi) => wi.status === "completed");
}

/**
 * Filters a ClientRundownData's sections, removing wrapper-children
 * whose parent wrapper is hidden, removing standalone L1s that are
 * hidden, and removing wrappers that are hidden.
 *
 * NOTE: Wave 1.7 already filters empty wrapper-children at extract +
 * render time (kind === "wrapper-child" && rows.length === 0). This
 * function adds the active-status filter on top.
 *
 * Conservative wrapper rule: at the rundown layer, orphan weekItem
 * statuses are not carried in `RawData.orphanWeekItems`. We therefore
 * keep any wrapper that has orphans, because we cannot prove they are
 * all terminal. Pure callers with full WeekItemRow data should use
 * `isWrapperHidden()` directly for precise evaluation.
 *
 * Returns a new ClientRundownData with hidden sections removed.
 * Does not mutate the input.
 */
export function filterActiveRundown(
  rundown: ClientRundownData,
): ClientRundownData {
  // First pass: identify hidden wrappers (keyed by wrapper project id, since
  // section anchors are slugs of names — wrapper-children link via the L1's
  // parentProjectId which is an id, not a slug).
  const hiddenWrapperIds = new Set<string>();

  for (const section of rundown.sections) {
    if (section.kind !== "wrapper") continue;
    const raw = section.data.raw;
    if (raw.kind !== "wrapper") continue;

    // Conservative: any orphans present keep the wrapper visible (status
    // not carried at this layer).
    if (raw.orphanWeekItems.length > 0) continue;

    // Empty children + no orphans = degenerate hollow wrapper, leave it
    // alone so it remains a data-integrity surface.
    if (raw.children.length === 0) continue;

    if (raw.children.every((c) => isL1Hidden(c))) {
      hiddenWrapperIds.add(raw.entity.id);
    }
  }

  // Second pass: drop hidden sections, preserving order.
  const filteredSections: RundownSection[] = rundown.sections.filter(
    (section) => {
      const raw = section.data.raw;

      if (section.kind === "wrapper") {
        if (raw.kind !== "wrapper") return true;
        return !hiddenWrapperIds.has(raw.entity.id);
      }

      if (section.kind === "wrapper-child") {
        // Drop if the parent wrapper was hidden, or if the child L1 itself
        // is hidden.
        if (raw.kind === "l1") {
          const parentId = raw.entity.parentProjectId;
          if (parentId && hiddenWrapperIds.has(parentId)) return false;
          return !isL1Hidden(raw.entity);
        }
        return true;
      }

      // standalone
      if (raw.kind === "l1") {
        return !isL1Hidden(raw.entity);
      }
      return true;
    },
  );

  return {
    ...rundown,
    sections: filteredSections,
  };
}
