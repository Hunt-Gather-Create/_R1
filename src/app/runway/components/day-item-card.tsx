"use client";

import type { DayItemEntry, DayItemType } from "../types";
import { getOwnerResourcesDisplay } from "./display-utils";
import { TYPE_INDICATORS, MetadataLabel } from "./status-badge";
import { DatesLine } from "./dates-line";
import { pastEndRedNote, pastEndNoteText } from "@/lib/runway/plate-summary";

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

interface DayItemCardProps {
  item: DayItemEntry;
  size?: "sm" | "lg";
}

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

/** Today's ISO date + ms. Memoized at module-load to avoid Date() in every render. */
function nowHelpers(): { iso: string; ms: number } {
  const d = new Date();
  return { iso: d.toISOString().slice(0, 10), ms: d.getTime() };
}

export function DayItemCard({ item, size = "sm" }: DayItemCardProps) {
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
    <div className={s.card} data-testid="day-item-card">
      <div className={`flex items-start justify-between ${s.gap}`}>
        <div className="min-w-0 flex-1">
          <p className={ACCOUNT_CLASS}>{item.account}</p>
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
        <span
          className={`mt-0.5 shrink-0 text-xs font-medium uppercase tracking-wider ${
            TYPE_INDICATORS[displayType] ?? "text-muted-foreground"
          }`}
        >
          {displayType}
        </span>
      </div>
    </div>
  );
}
