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
import type { ClientRundownData } from "@/lib/runway/gantt/types";
import { AccountTier, type AccountForTier } from "./account-tier/AccountTier";

type AccountWithWiring = Account & {
  rundown?: ClientRundownData | null;
  readyToCloseIds?: ReadonlySet<string>;
};

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
 * tier consumes. Several fields don't exist on `Account` today
 * (`severity`, `contractStart`, `contractEnd`); we leave them null so
 * the tier renders a clean header without the badges/dates that the
 * data layer doesn't surface yet. `sowSigned` derives from
 * `contractStatus === "signed"`.
 */
function toAccountForTier(account: AccountWithWiring): AccountForTier {
  return {
    name: account.name,
    slug: account.slug,
    team: account.team ?? null,
    severity: null,
    sowSigned: account.contractStatus === "signed",
    contractStart: null,
    contractEnd: null,
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
