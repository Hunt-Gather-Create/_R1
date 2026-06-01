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
 * `text-muted-foreground`, `border-border`.
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
import { CompleteCheckbox } from "../complete-checkbox";
import { EditPencil } from "../dashboard-edit-pencil";

type WeekItemForCard = {
  id: string;
  title: string;
  owner: string | null;
  resources: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  category: string | null;
  // P1.3 (TP review on b7c89f3): threaded through so the dashboard edit
  // modal pre-fills the read-only Project field + the Notes textarea when
  // opened from the By Account view. Optional — older callers that haven't
  // started passing them yet just get an empty modal value.
  notes?: string | null;
  parentProjectName?: string | null;
  // #81 — parent project's category (`projects.category`). Surfaced
  // read-only beside the editable WI chip category in the edit modal.
  // Pulled at the AccountTier level from `section.data.raw.entity.category`
  // when raw.kind === "l1".
  parentCategory?: string | null;
  // #70 commit 8b — project id powers the modal's project picker.
  // AnnotatedRow doesn't carry this directly (it's a query-time field on
  // weekItems), so AccountTier looks it up alongside parentProjectName.
  projectId?: string | null;
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
  warningCount?: number;
  criticalCount?: number;
}) {
  const {
    id,
    title,
    owner,
    resources,
    startDate,
    endDate,
    status,
    category,
    notes,
    parentProjectName,
    parentCategory,
    projectId,
  } = weekItem;

  const categoryClass =
    category && TYPE_INDICATORS[category]
      ? TYPE_INDICATORS[category]
      : "text-muted-foreground";

  return (
    <div
      data-testid="l2-mini-card"
      className="relative w-full sm:w-[260px] sm:flex-shrink-0 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4"
    >
      <EditPencil
        item={{
          id,
          title,
          owner,
          resources,
          startDate,
          endDate,
          status,
          category,
          notes,
          parentProjectName,
          parentCategory,
          projectId,
        }}
      />
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
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <CompleteCheckbox weekItemId={id} title={title} status={status} />
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
