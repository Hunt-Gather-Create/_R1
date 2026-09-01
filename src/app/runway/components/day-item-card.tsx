"use client";

import type { DayItemEntry, DayItemType } from "../types";
import { getOwnerResourcesDisplay } from "./display-utils";
import { TYPE_INDICATORS, MetadataLabel } from "./status-badge";
import { DatesLine } from "./dates-line";
import { pastEndRedNote, pastEndNoteText } from "@/lib/runway/plate-summary";
import { chicagoToday } from "@/lib/runway/date-chicago";
import { CompleteCheckbox } from "./complete-checkbox";
import { EditPencil } from "./dashboard-edit-pencil";

const HOLD_PATTERN = /\b(hold[s]?\s+until|on\s+hold|blocked|not\s+starting\s+until)\b/i;
const RISK_PATTERN = /\(Risk:\s*([^)]+)\)/;
const NEXT_STEP_PATTERN = /^Next Step:\s*/;

/**
 * Override the display type to "blocked" if notes contain hold/blocked language.
 */
export function getEffectiveType(item: DayItemEntry): DayItemType {
  if (item.type === "blocked") return "blocked";
  if (item.notes && HOLD_PATTERN.test(item.notes)) return "blocked";
  return item.type;
}

/**
 * Parse notes into main text and optional risk warning.
 */
export function parseNotes(notes: string): { main: string; risk?: string; isNextStep: boolean } {
  const riskMatch = notes.match(RISK_PATTERN);
  const risk = riskMatch ? riskMatch[1].trim() : undefined;
  const mainText = notes.replace(RISK_PATTERN, "").trim();
  const isNextStep = NEXT_STEP_PATTERN.test(mainText);
  const main = mainText.replace(NEXT_STEP_PATTERN, "").trim();
  return { main, risk, isNextStep };
}

/**
 * #64 Status View — bottom-banner accent. The banner is a ~6 px stripe
 * inside the card, flush with the bottom edge, signaling which Status View
 * bucket the card inherited from. Card body stays clean. Omitted means no
 * stripe (default everywhere except the Status View tab).
 */
export type CardBottomBanner =
  | "needs-update"
  | "today"
  | "kicks-off"
  | "in-flight";

interface DayItemCardProps {
  item: DayItemEntry;
  size?: "sm" | "lg";
  bottomBanner?: CardBottomBanner;
}

const BOTTOM_BANNER_CLASS: Record<CardBottomBanner, string> = {
  "needs-update": "bg-red-500/70",
  today: "bg-white/80",
  // #71 Kicks Off This Week — Tue-Fri startDate inside the work week.
  // Yellow keeps the traffic-light feel alongside red / white / blue.
  "kicks-off": "bg-yellow-400",
  "in-flight": "bg-sky-500/70",
};

const ACCOUNT_CLASS = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const SIZE_CLASSES = {
  sm: {
    card: "rounded-lg border border-border/50 bg-background/50 p-3",
    title: "mt-0.5 text-sm font-medium leading-snug text-foreground",
    meta: "mt-1 flex flex-wrap items-center gap-2",
    metaText: "text-xs text-muted-foreground",
    notes: "mt-1 text-xs text-muted-foreground/70",
    gap: "gap-2",
  },
  lg: {
    card: "rounded-xl border border-sky-500/30 bg-sky-500/5 p-4",
    title: "mt-0.5 text-base font-medium leading-snug text-foreground",
    meta: "mt-2 flex flex-wrap items-center gap-2",
    metaText: "text-sm text-muted-foreground",
    notes: "mt-2 text-sm text-muted-foreground/70",
    gap: "gap-3",
  },
} as const;

/**
 * Today's ISO date, Chicago not the viewer's own device clock, refs
 * _R1#128, plus the current instant in ms. ms stays a plain instant
 * since daysSinceTouched below is a duration, not a calendar comparison,
 * and a duration in milliseconds does not depend on any timezone.
 */
function nowHelpers(): { iso: string; ms: number } {
  return { iso: chicagoToday(), ms: Date.now() };
}

export function DayItemCard({ item, size = "sm", bottomBanner }: DayItemCardProps) {
  const s = SIZE_CLASSES[size];
  const displayType = getEffectiveType(item);
  const { showOwnerSeparately, displayResources } = getOwnerResourcesDisplay(item);

  const parsed = item.notes ? parseNotes(item.notes) : null;

  // v4 (chunk 3 #3): past-end inline note when an in-progress L2's end_date
  // slipped into the past. Keeps the card silent otherwise.
  const { iso: nowISO, ms: nowMs } = nowHelpers();
  const pastEnd = pastEndRedNote(item, nowISO, nowMs);

  // v4 (chunk 3 #7): render blocked_by cue when upstream L2s are not yet done.
  const blockers = item.blockedBy ?? [];

  return (
    <div
      className={`${s.card} relative ${bottomBanner ? "overflow-hidden pb-5" : ""}`}
      data-testid="day-item-card"
    >
      {item.id ? (
        <EditPencil
          item={{
            id: item.id,
            title: item.title,
            owner: item.owner ?? null,
            resources: item.resources ?? null,
            startDate: item.startDate ?? null,
            endDate: item.endDate ?? null,
            status: item.status ?? null,
            notes: item.notes ?? null,
            category: item.category ?? null,
            parentProjectName: item.parentProjectName ?? null,
            parentCategory: item.parentCategory ?? null,
            projectId: item.projectId ?? null,
          }}
        />
      ) : null}
      <div className={`flex items-start justify-between ${s.gap}`}>
        <div className="min-w-0 flex-1">
          <p className={ACCOUNT_CLASS}>{item.account}</p>
          {item.parentProjectName ? (
            <p
              data-testid="parent-project-name"
              className="text-xs text-muted-foreground/60 leading-tight mb-0.5"
            >
              {item.parentProjectName}
            </p>
          ) : null}
          <p className={s.title}>{item.title}</p>
          <div className={s.meta}>
            <DatesLine
              startDate={item.startDate}
              endDate={item.endDate}
              className={s.metaText}
            />
          </div>
          <div className={s.meta}>
            {displayResources ? (
              <MetadataLabel label="Resources" value={displayResources} className={s.metaText} />
            ) : null}
          </div>
          {parsed ? (
            <div className={s.notes}>
              {parsed.isNextStep ? (
                <span>
                  <span className="font-medium text-muted-foreground">Next Step:</span>{" "}
                  {parsed.main}
                </span>
              ) : (
                <span>{parsed.main}</span>
              )}
              {parsed.risk ? (
                <span className="ml-1 text-amber-400/80">(Risk: {parsed.risk})</span>
              ) : null}
            </div>
          ) : null}
          {pastEnd ? (
            <p
              data-testid="past-end-note"
              className="mt-1 text-xs font-medium text-red-300/90"
            >
              {pastEndNoteText(pastEnd.daysSinceTouched)}
            </p>
          ) : null}
          {blockers.length > 0 ? (
            <div
              data-testid="blocked-by-cue"
              className="mt-1 flex flex-wrap gap-1 pl-3 border-l-2 border-muted-foreground/30"
            >
              {blockers.map((b) => (
                <span
                  key={b.id}
                  title={b.status ? `blocked by: ${b.title} (${b.status})` : `blocked by: ${b.title}`}
                  className="text-xs text-muted-foreground/80"
                >
                  <span aria-hidden className="mr-1">&rarr;</span>
                  blocked by: {b.title}
                  {b.status ? <span className="ml-1 text-muted-foreground/60">({b.status})</span> : null}
                </span>
              ))}
            </div>
          ) : null}
          {showOwnerSeparately ? (
            <div className="mt-1">
              <MetadataLabel label="Owner" value={item.owner!} className="text-xs text-muted-foreground/50" />
            </div>
          ) : null}
        </div>
        {/* #82 — pt-6 drops the checkbox below the absolute-positioned
            EditPencil button at top-right so they don't visually collide. */}
        <div className="flex shrink-0 flex-col items-end gap-1.5 pt-6">
          <CompleteCheckbox
            weekItemId={item.id}
            title={item.title}
            status={item.status ?? null}
          />
          <span
            className={`mt-0.5 text-xs font-medium uppercase tracking-wider ${
              TYPE_INDICATORS[displayType] ?? "text-muted-foreground"
            }`}
          >
            {displayType}
          </span>
        </div>
      </div>
      {bottomBanner ? (
        <div
          data-testid="bottom-banner"
          data-bucket={bottomBanner}
          aria-hidden="true"
          className={`absolute inset-x-0 bottom-0 h-1.5 ${BOTTOM_BANNER_CLASS[bottomBanner]}`}
        />
      ) : null}
    </div>
  );
}
