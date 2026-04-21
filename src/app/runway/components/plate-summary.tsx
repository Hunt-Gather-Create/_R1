"use client";

import type { Account, TriageItem } from "../types";
import {
  retainerRenewalPills,
  retainerPillText,
  contractExpiredPills,
  contractExpiredPillText,
} from "@/lib/runway/plate-summary";

interface PlateSummaryProps {
  accounts: Account[];
  /** ISO date used as "today". Callers use a stable value — defaults to new Date(). */
  nowISO?: string;
}

/**
 * Plate summary — soft flags rendered at the top of the Week Of / board
 * view. Currently surfaces:
 *  - Retainer renewals within 30 days (chunk 3 #4)
 *  - Expired contracts with active work (chunk 3 #5)
 *
 * Pills render as muted, non-blocking copy; they inform but don't alarm.
 * Returns null when nothing applies so the layout collapses cleanly.
 */
export function PlateSummary({ accounts, nowISO }: PlateSummaryProps) {
  const today = nowISO ?? new Date().toISOString().slice(0, 10);

  const allTriageItems: TriageItem[] = accounts.flatMap((a) => a.items);
  const renewalPills = retainerRenewalPills(allTriageItems, today);
  const expiredPills = contractExpiredPills(accounts);

  if (renewalPills.length === 0 && expiredPills.length === 0) return null;

  return (
    <section
      aria-label="Plate summary"
      data-testid="plate-summary"
      className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 sm:p-4"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">
        Soft Flags
      </p>
      <div className="flex flex-wrap gap-2">
        {renewalPills.map((pill) => (
          <span
            key={`renewal-${pill.projectName}-${pill.contractEnd}`}
            data-testid="retainer-renewal-pill"
            className="rounded-full border border-amber-500/30 bg-background/50 px-2.5 py-1 text-xs text-amber-200"
          >
            {retainerPillText(pill)}
          </span>
        ))}
        {expiredPills.map((pill) => (
          <span
            key={`expired-${pill.clientName}`}
            data-testid="contract-expired-pill"
            className="rounded-full border border-red-500/30 bg-background/50 px-2.5 py-1 text-xs text-red-200"
          >
            {contractExpiredPillText(pill)}
          </span>
        ))}
      </div>
    </section>
  );
}
