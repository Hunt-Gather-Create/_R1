/**
 * Track 4 Wave 4.6 — L2 mini-card mirrors the By Week task card.
 *
 * Operator feedback: "On the cards themselves just mirror the week of cards."
 * The visual format follows `day-item-card.tsx` (the `lg` size variant):
 *
 *   - Account name (uppercase, semibold, dim, small) at the top
 *   - Title below (foreground, font-medium, leading-snug)
 *   - "Dates: M/D" or "Dates: M/D – M/D" (hidden when both null)
 *   - "Resources: <value>" (hidden when null)
 *   - "Owner: <value>" (hidden when null)
 *   - Category indicator at top-right (uppercase, color-coded via TYPE_INDICATORS)
 *   - Warning / critical alert badges near the category indicator
 *
 * Design tokens replace explicit slate scales — `text-foreground`,
 * `text-muted-foreground`, `border-border`. The `theme` prop stays on the
 * signature for downstream API stability but no longer drives colors.
 *
 * Status filtering: completed/canceled L2s never reach this card — they
 * are filtered upstream in `AccountTier.tsx` (correction #1). The opacity
 * dim and strikethrough states are gone. Defensive: render normally.
 *
 * Card chrome: `rounded-xl border border-sky-500/30 bg-sky-500/5` mirrors
 * the high-priority By Week card. Width is flexible (`w-full sm:w-[260px]
 * sm:flex-shrink-0`) so cards lay out left-to-right via flex-wrap and
 * adapt to viewport.
 */

import { TYPE_INDICATORS, MetadataLabel } from "../status-badge";
import { DatesLine } from "../dates-line";

type Theme = "light" | "dark";

type WeekItemForCard = {
  id: string;
  title: string;
  owner: string | null;
  resources: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  category: string | null;
};

const ACCOUNT_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const META_TEXT_CLASS = "text-sm text-muted-foreground";

export function L2MiniCard({
  weekItem,
  accountName,
  warningCount = 0,
  criticalCount = 0,
}: {
  weekItem: WeekItemForCard;
  accountName?: string;
  /**
   * Kept on the signature for API stability — downstream consumers may
   * still pass it. Color decisions now flow through design tokens, so
   * this value is unused in render output.
   */
  theme?: Theme;
  warningCount?: number;
  criticalCount?: number;
}) {
  const { title, owner, resources, startDate, endDate, category } = weekItem;

  const categoryClass =
    category && TYPE_INDICATORS[category]
      ? TYPE_INDICATORS[category]
      : "text-muted-foreground";

  return (
    <div
      data-testid="l2-mini-card"
      className="w-full sm:w-[260px] sm:flex-shrink-0 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {accountName ? <p className={ACCOUNT_CLASS}>{accountName}</p> : null}
          <p className="mt-0.5 text-base font-medium leading-snug text-foreground">
            {title}
          </p>
          {(startDate || endDate) ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <DatesLine
                startDate={startDate}
                endDate={endDate}
                className={META_TEXT_CLASS}
              />
            </div>
          ) : null}
          {resources ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <MetadataLabel
                label="Resources"
                value={resources}
                className={META_TEXT_CLASS}
              />
            </div>
          ) : null}
          {owner ? (
            <div className="mt-1">
              <MetadataLabel
                label="Owner"
                value={owner}
                className="text-sm text-muted-foreground/70"
              />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {category ? (
            <span
              data-testid="category-chip"
              className={`text-xs font-medium uppercase tracking-wider ${categoryClass}`}
            >
              {category}
            </span>
          ) : null}
          {warningCount > 0 || criticalCount > 0 ? (
            <span
              data-testid="alert-badge"
              className="flex items-center gap-1 text-[10px] font-medium"
            >
              {warningCount > 0 ? (
                <span className="text-amber-500">{warningCount} warn</span>
              ) : null}
              {criticalCount > 0 ? (
                <span className="text-red-500">{criticalCount} critical</span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
