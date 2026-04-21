"use client";

import { useMemo } from "react";
import type { Account, TriageItem, DayItemEntry } from "../types";
import { getOwnerResourcesDisplay } from "./display-utils";
import { StatusBadge, StaleBadge, ContractBadge, MetadataLabel } from "./status-badge";

/**
 * Extended triage item with unified-view L2 milestones attached.
 * Kept in this file as an optional prop field so AccountSection works for
 * both the legacy (no milestones) and unified (with milestones) shapes.
 */
type TriageItemWithMilestones = TriageItem & { milestones?: DayItemEntry[] };

const DATE_PATTERN = /(\d{1,2})\/(\d{1,2})/;

/**
 * Parse a target string like "4/11", "w/o 4/20", "Late March", "May" into a sortable value.
 * Returns a large number for unparseable values so they sort to the end.
 */
function targetSortKey(target?: string): number {
  if (!target) return 99999;
  const match = target.match(DATE_PATTERN);
  if (match) return parseInt(match[1]) * 100 + parseInt(match[2]);
  return 99998;
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

function ProjectCard({ item }: { item: TriageItemWithMilestones }) {
  const { showOwnerSeparately, displayResources } = getOwnerResourcesDisplay(item);

  // Chunk 3 #1 — unified Project View: L2 milestones rendered inline
  // under each L1 when the caller provides them. Silent when absent.
  const milestones = item.milestones ?? [];

  return (
    <div className="border-t border-border/30 py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground">{item.title}</p>
          <StatusBadge status={item.status} />
          {item.staleDays ? <StaleBadge days={item.staleDays} /> : null}
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
          {item.target ? (
            <MetadataLabel label="Target" value={item.target} className="text-xs text-sky-400/80" />
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
        .sort((a, b) => targetSortKey(a.target) - targetSortKey(b.target)),
    [account.items]
  );

  const holdItems = useMemo(
    () => account.items.filter((i) => i.category === "on-hold"),
    [account.items]
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
          {account.contractValue ? (
            <p className="text-sm font-medium text-foreground">
              {account.contractValue}
            </p>
          ) : null}
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
            <ProjectCard key={item.id} item={item} />
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
