"use client";

import { useMemo, useState } from "react";
import type { Account, TriageItem, DayItemEntry } from "../types";
import { accountHasWrapper } from "../unified-view";
import { getOwnerResourcesDisplay } from "./display-utils";
import { StatusBadge, StaleBadge, ContractBadge, MetadataLabel } from "./status-badge";
import { DatesLine } from "./dates-line";

/**
 * Extended triage item with unified-view L2 milestones attached.
 * Kept in this file as an optional prop field so AccountSection works for
 * both the legacy (no milestones) and unified (with milestones) shapes.
 * Also carries optional `children` when this L1 is a retainer wrapper
 * (PR #88 Chunk F) — nested children render their own milestones inline.
 */
type TriageItemWithMilestones = TriageItem & {
  milestones?: DayItemEntry[];
  children?: TriageItemWithMilestones[];
};

/**
 * Threshold for auto-collapsing retainer wrappers. Keeps wide wrappers
 * (e.g. a retainer that spans 10+ deliverables) from blowing out the page
 * on first render. v4 convention (2026-04-21 / PR #88 Chunk F).
 */
const WRAPPER_AUTO_COLLAPSE_THRESHOLD = 5;

/**
 * Sort key built on ISO `startDate` (YYYY-MM-DD). Items with no startDate
 * sort to the end. Lexicographic comparison on the ISO string preserves
 * chronological order without parsing into a Date.
 *
 * Replaces the legacy `targetSortKey` free-text parser (PR 88 Wave 2) —
 * the `projects.target` column was dropped in favor of structured
 * startDate/endDate.
 */
function startDateSortKey(startDate?: string | null): string {
  return startDate ?? "\uffff";
}

/**
 * Expand common contract abbreviations for readability.
 */
function formatContractTerm(term?: string): string | undefined {
  if (!term) return undefined;
  return term
    .replace(/\bMSA\b/g, "Master Service Agreement")
    .replace(/\bSOW\b/g, "Statement of Work")
    .replace(/\bNDA\b/g, "Non-Disclosure Agreement");
}

/**
 * Inner body of a project card -- the identity line, metadata row,
 * notes, and inline L2 milestone list. Extracted so a retainer wrapper
 * card can reuse the same rendering for both the wrapper header and
 * each nested child card without duplication.
 */
function ProjectCardBody({
  item,
  outsideRetainer = false,
}: {
  item: TriageItemWithMilestones;
  outsideRetainer?: boolean;
}) {
  const { showOwnerSeparately, displayResources } = getOwnerResourcesDisplay(item);

  // Chunk 3 #1 — unified Project View: L2 milestones rendered inline
  // under each L1 when the caller provides them. Silent when absent.
  const milestones = item.milestones ?? [];

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium text-foreground">{item.title}</p>
        <StatusBadge status={item.status} />
        {item.staleDays ? <StaleBadge days={item.staleDays} /> : null}
        {outsideRetainer ? (
          <span
            data-testid="outside-retainer-marker"
            className="rounded-full border border-muted-foreground/30 bg-muted/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            Outside retainer
          </span>
        ) : null}
      </div>
      <div className="mt-1">
        <DatesLine startDate={item.startDate} endDate={item.endDate} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {displayResources ? (
          <MetadataLabel label="Resources" value={displayResources} />
        ) : null}
        {showOwnerSeparately ? (
          <MetadataLabel label="Owner" value={item.owner!} className="text-xs text-muted-foreground/50" />
        ) : null}
        {item.waitingOn ? (
          <MetadataLabel label="Waiting on" value={item.waitingOn} className="text-xs text-amber-400/80" />
        ) : null}
      </div>
      {item.notes ? (
        <p className="mt-1 text-xs text-muted-foreground/70">
          {item.notes}
        </p>
      ) : null}
      {milestones.length > 0 ? (
        <ul
          data-testid="project-milestones"
          className="mt-2 space-y-0.5 pl-3 text-xs text-muted-foreground/80"
        >
          {milestones.map((m, i) => (
            <li key={`${m.id ?? m.title}-${i}`} className="flex items-center gap-1.5">
              <span aria-hidden className="text-muted-foreground/40">&bull;</span>
              <span>{m.title}</span>
              {m.status ? (
                <span className="text-muted-foreground/60">({m.status})</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ProjectCard({
  item,
  outsideRetainer = false,
}: {
  item: TriageItemWithMilestones;
  outsideRetainer?: boolean;
}) {
  const children = item.children ?? [];
  const hasChildren = children.length > 0;
  // v4 (PR #88 Chunk F): auto-collapse wide wrappers so a retainer with 15+
  // deliverable L1s doesn't blow out the page on first render. Operators
  // can still expand manually.
  const [expanded, setExpanded] = useState(
    hasChildren ? children.length < WRAPPER_AUTO_COLLAPSE_THRESHOLD : true,
  );

  if (!hasChildren) {
    return (
      <div className="border-t border-border/30 py-3 first:border-t-0 first:pt-0">
        <ProjectCardBody item={item} outsideRetainer={outsideRetainer} />
      </div>
    );
  }

  return (
    <div
      data-testid="project-wrapper-card"
      className="border-t border-border/30 py-3 first:border-t-0 first:pt-0"
    >
      <div className="flex items-start justify-between gap-2">
        <ProjectCardBody item={item} />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          data-testid="project-wrapper-toggle"
          className="shrink-0 rounded px-2 py-0.5 text-xs text-muted-foreground/70 hover:bg-muted/30 hover:text-foreground"
        >
          {expanded ? "Collapse" : `Expand (${children.length})`}
        </button>
      </div>
      {expanded ? (
        <ul
          data-testid="project-wrapper-children"
          className="mt-3 space-y-0 border-l-2 border-border/40 pl-3"
        >
          {children.map((child) => (
            <li key={child.id} className="py-2 first:pt-0 last:pb-0">
              <ProjectCardBody item={child} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface AccountSectionProps {
  /**
   * Account with standard triage items. When the caller provides items that
   * also carry `milestones` (unified Project View — chunk 3 #1), ProjectCard
   * renders them inline without any additional prop plumbing.
   */
  account: Account | (Omit<Account, "items"> & { items: TriageItemWithMilestones[] });
}

export function AccountSection({ account }: AccountSectionProps) {
  const activeItems = useMemo(
    () =>
      account.items
        .filter(
          (i) => i.category === "active" || i.category === "awaiting-client"
        )
        .slice()
        .sort((a, b) => {
          const keyA = startDateSortKey(a.startDate);
          const keyB = startDateSortKey(b.startDate);
          if (keyA !== keyB) return keyA < keyB ? -1 : 1;
          return 0;
        }),
    [account.items]
  );

  const holdItems = useMemo(
    () => account.items.filter((i) => i.category === "on-hold"),
    [account.items]
  );

  // True when the account contains a retainer L1 that ≥1 in-account L1
  // references via parentProjectId. Standalone L1s in that account that
  // are NOT themselves retainers and are NOT nested under the wrapper
  // render with an "Outside retainer" marker so it's obvious on the
  // board that they sit outside the retainer's scope.
  const hasWrapper = useMemo(
    () => accountHasWrapper(account),
    [account],
  );

  const displayTerm = formatContractTerm(account.contractTerm);

  return (
    <div className="rounded-xl border border-border bg-card/30 p-3 sm:p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-foreground sm:text-xl">{account.name}</h3>
          {account.team ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {account.team}
            </p>
          ) : null}
        </div>
        <div className="sm:text-right">
          {/* Dollar amounts moved to Pipeline view only (2026-04 operator
              ask). By Account is the "what's in play" view; contract value
              noise distracts from the work list. Contract term + status
              badge stay — they describe the engagement, not its price. */}
          {displayTerm ? (
            <p className="text-xs text-muted-foreground">
              {displayTerm}
            </p>
          ) : null}
          <ContractBadge status={account.contractStatus} />
        </div>
      </div>

      {activeItems.length > 0 ? (
        <div className="space-y-0">
          {activeItems.map((item) => (
            <ProjectCard
              key={item.id}
              item={item}
              outsideRetainer={
                hasWrapper &&
                !item.parentProjectId &&
                item.engagementType !== "retainer"
              }
            />
          ))}
        </div>
      ) : null}

      {holdItems.length > 0 ? (
        <div className="mt-3 border-t border-border/30 pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/50">
            On Hold
          </p>
          {holdItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground/60"
            >
              <span>{item.title}</span>
              {item.notes ? <span>— {item.notes}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
