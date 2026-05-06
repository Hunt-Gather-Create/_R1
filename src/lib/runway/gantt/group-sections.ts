/**
 * Shared section-grouping helper for Gantt rundown consumers.
 *
 * Track 4 audit fix (2026-05-05, WARN — Panel 3, Performance): the same
 * algorithm previously lived as inline copies inside
 * `src/app/runway/components/account-tier/AccountTier.tsx` and
 * `src/app/runway/components/rundown-content-rsc.tsx`. Extracting to one
 * module removes the drift risk if a future operator changes the
 * wrapper-child grouping rule on one consumer without remembering the
 * other.
 *
 * The grouping pass walks a flat `RundownSection[]` left-to-right and
 * collapses each (wrapper, wrapper-child*) run into a single
 * `wrapper`-block. Standalone sections that fall between wrappers close
 * the open wrapper and stand on their own. A wrapper-child appearing
 * before any wrapper is demoted to standalone (defensive guard against
 * malformed upstream data).
 */

import type { RundownSection } from "./types";

/**
 * The two block shapes any consumer cares about. The shared helper
 * returns this union so each consumer can switch on `kind` and render
 * the appropriate header + children layout.
 */
export type SectionBlock =
  | { kind: "wrapper"; wrapper: RundownSection; children: RundownSection[] }
  | { kind: "standalone"; section: RundownSection };

/**
 * Group flat sections list into wrapper-blocks and standalone-blocks.
 * - `wrapper` section opens a new block; subsequent `wrapper-child`
 *   sections accumulate into its `children` array.
 * - `standalone` section closes any open wrapper block and stands alone.
 * - `wrapper-child` appearing before any wrapper is demoted to standalone
 *   so it still renders rather than vanishing silently.
 *
 * Order is preserved: blocks come out in the same left-to-right order
 * the input flat list provided.
 */
export function groupSections(
  sections: readonly RundownSection[],
): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  let currentWrapper: {
    wrapper: RundownSection;
    children: RundownSection[];
  } | null = null;

  for (const s of sections) {
    if (s.kind === "wrapper") {
      if (currentWrapper) {
        blocks.push({ kind: "wrapper", ...currentWrapper });
      }
      currentWrapper = { wrapper: s, children: [] };
    } else if (s.kind === "wrapper-child") {
      if (currentWrapper) {
        currentWrapper.children.push(s);
      } else {
        // Defensive: orphaned wrapper-child appearing before any wrapper
        // gets demoted to a standalone block so it still renders.
        blocks.push({ kind: "standalone", section: s });
      }
    } else {
      // standalone — close any open wrapper, then push.
      if (currentWrapper) {
        blocks.push({ kind: "wrapper", ...currentWrapper });
        currentWrapper = null;
      }
      blocks.push({ kind: "standalone", section: s });
    }
  }

  if (currentWrapper) {
    blocks.push({ kind: "wrapper", ...currentWrapper });
  }
  return blocks;
}
