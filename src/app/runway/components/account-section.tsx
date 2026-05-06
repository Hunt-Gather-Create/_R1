"use client";

/**
 * Track 4 Wave 4.3 — By Account tab consumer.
 *
 * AccountSection is now a thin wrapper around <AccountTier>. The tier
 * component owns three-level Client / Wrapper / L1 hierarchy + the L2
 * mini-card swimlane (Wave 4.1 + 4.2). This file's job is to map the
 * board-level `account` shape (an `Account | UnifiedAccount` carrying
 * Track 3/4 wiring fields) into the `AccountForTier` props the tier
 * expects, and forward the active-filtered rundown + readyToCloseIds.
 *
 * Empty-state: when `account.rundown` is null OR has zero sections, we
 * render a compact card with the client name + a dim "No active
 * rundowns." line. This preserves the contract that AccountSection
 * always renders something for the account (page.tsx upstream filter
 * drops accounts whose filtered rundown has zero sections, so this
 * branch is the data-integrity-nudge fallback for clients without a
 * rundown row at all).
 */

import type { Account } from "../types";
import type {
  ClientRundownData,
  SeverityCounts,
} from "@/lib/runway/gantt/types";
import { AccountTier, type AccountForTier } from "./account-tier/AccountTier";

type AccountWithWiring = Account & {
  rundown?: ClientRundownData | null;
  readyToCloseIds?: ReadonlySet<string>;
  /**
   * Track 3 Wave 4: page.tsx attaches the client's overall severity rollup
   * (counts of critical / warn / info issues across the active-filtered
   * Gantt rundown). The Track 4 audit fix threads this through into the
   * tier's `severity` prop so the client header chips render correctly.
   */
  ganttSeverity?: SeverityCounts;
};

/**
 * Track 4 audit fix (2026-05-05): collapse the per-account severity rollup
 * (critical/warn/info counts) into the discriminator the client header
 * SeverityBadge expects. Critical wins over warning; both must be > 0 to
 * fire the badge. Info-only and zero-counts return null so the header
 * stays clean.
 */
export function deriveSeverity(
  counts: SeverityCounts | undefined,
): "critical" | "warning" | null {
  if (!counts) return null;
  if (counts.critical > 0) return "critical";
  if (counts.warn > 0) return "warning";
  return null;
}

interface AccountSectionProps {
  /**
   * Account shape from the board. May carry the new Track 4 wiring
   * fields (`rundown`, `readyToCloseIds`) attached upstream in page.tsx.
   * Tests sometimes pass the bare `Account` — both shapes flow through.
   */
  account: AccountWithWiring;
  /**
   * Track 3 Wave 5: optional explicit readyToCloseIds. When present it
   * wins over `account.readyToCloseIds`. Kept for back-compat with
   * existing test wires that pass it as a discrete prop.
   */
  readyToCloseIds?: ReadonlySet<string>;
}

/**
 * Map the board's `Account` shape onto the `AccountForTier` shape the
 * tier consumes. Track 4 audit fix (2026-05-05): `severity` now derives
 * from the per-account `ganttSeverity` rollup (page.tsx attaches it via
 * the active-filtered rundown), and `contractStart`/`contractEnd` thread
 * through from the retainer wrapper L1. `sowSigned` continues to derive
 * from `contractStatus === "signed"`.
 */
function toAccountForTier(account: AccountWithWiring): AccountForTier {
  return {
    name: account.name,
    slug: account.slug,
    team: account.team ?? null,
    severity: deriveSeverity(account.ganttSeverity),
    sowSigned: account.contractStatus === "signed",
    contractStart: account.contractStart ?? null,
    contractEnd: account.contractEnd ?? null,
  };
}

export function AccountSection({ account, readyToCloseIds }: AccountSectionProps) {
  const accountReadyIds: ReadonlySet<string> =
    readyToCloseIds ?? account.readyToCloseIds ?? new Set<string>();

  const rundown = account.rundown ?? null;
  const hasSections = rundown !== null && rundown.sections.length > 0;

  if (!hasSections) {
    return (
      <div
        data-testid="account-section-empty"
        className="rounded-xl border border-border bg-card/30 p-3 sm:p-5"
      >
        <h3 className="text-lg font-bold text-foreground sm:text-xl">
          {account.name}
        </h3>
        {account.team ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{account.team}</p>
        ) : null}
        <p className="mt-3 text-xs text-muted-foreground/60">
          No active rundowns.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/30 p-3 sm:p-5">
      <AccountTier
        account={toAccountForTier(account)}
        rundown={rundown}
        readyToCloseIds={accountReadyIds}
        theme="light"
      />
    </div>
  );
}
