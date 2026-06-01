/**
 * Client-safe export of the L2 week_items.category enum (the card chip
 * values — delivery, review, kickoff, etc.).
 *
 * Lives in its own module so client components (e.g. the dashboard edit
 * modal's #84 Category dropdown) can import WEEK_ITEM_CATEGORIES
 * without dragging in operations-utils.ts — which transitively imports
 * `node:async_hooks` via runway-als and therefore can't appear in a
 * client bundle. Same pattern as week-item-statuses.ts.
 *
 * operations-utils.ts re-exports both bindings from this file so there's
 * a single source of truth for the enum.
 */

export const WEEK_ITEM_CATEGORIES = [
  "delivery",
  "review",
  "kickoff",
  "deadline",
  "approval",
  "launch",
] as const;

export type WeekItemCategory = (typeof WEEK_ITEM_CATEGORIES)[number];
