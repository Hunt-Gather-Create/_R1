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
 * Plate summary — informational pills rendered at the top of the Week Of /
 * board view. Currently surfaces:
 *  - Retainer renewals within 30 days (chunk 3 #4)
 *  - Expired contracts with active work (chunk 3 #5)
 *
 * Header was renamed from "Soft Flags" to "In Flight" in PR #88 chunk A;
 * the pills are informational (upcoming renewal, contract state), not
 * urgent, so the emerald palette reads better than the old amber warning.
 * Expired-contract pills keep the red palette (they are urgent).
 *
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
      className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 sm:p-4"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
        In Flight
      </p>
      <div className="flex flex-wrap gap-2">
        {renewalPills.map((pill) => (
          <span
            key={`renewal-${pill.projectName}-${pill.contractEnd}`}
            data-testid="retainer-renewal-pill"
            className="rounded-full border border-emerald-500/30 bg-background/50 px-2.5 py-1 text-xs text-emerald-200"
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
