/**
 * Client-safe export of the L2 week_items.status enum.
 *
 * Lives in its own module so client components (e.g. the dashboard edit
 * modal from #70) can import WEEK_ITEM_STATUSES without dragging in
 * operations-utils.ts — which transitively imports `node:async_hooks`
 * via runway-als and therefore can't appear in a client bundle.
 *
 * operations-utils.ts re-exports both bindings from this file so there's
 * a single source of truth for the enum.
 */

export const WEEK_ITEM_STATUSES = [
  "scheduled",
  "in-progress",
  "blocked",
  "at-risk",
  "completed",
  "canceled",
] as const;

export type WeekItemStatus = (typeof WEEK_ITEM_STATUSES)[number];
