"use client";

/**
 * Gantt Charts tab — Track 3 Wave 4.
 *
 * Renders one card per surviving account, slotting the RSC-prerendered
 * dark Gantt embed (`ganttContent`) inside each card. Survivor selection
 * + `ganttContent` rendering both happen upstream in `page.tsx`; this
 * component is a thin presentation layer.
 *
 * The dark-embed CSS module mirrors the Track 2 pattern: a single
 * container at the top of this section provides the `.darkEmbed` scope
 * for all the inner Gantt sections so their structural rules apply
 * without leaking globally.
 *
 * FlagsPanel is hidden on this tab (operator-locked); see runway-board.tsx
 * `view !== "gantt-charts"` guard.
 */

import type { ReactNode } from "react";
import type { Account } from "../types";
import type { UnifiedAccount } from "../unified-view";
import type { SeverityCounts } from "@/lib/runway/gantt/types";
import { AuditBadge } from "./audit-badge";
import styles from "./gantt-dark-embed.module.css";

type AccountWithGantt = (Account | UnifiedAccount) & {
  ganttContent?: ReactNode;
  ganttSeverity?: SeverityCounts;
};

export function GanttChartsSection({
  accounts,
}: {
  accounts: AccountWithGantt[];
}) {
  if (accounts.length === 0) {
    return (
      <div
        data-testid="gantt-charts-empty"
        className="py-12 text-center text-sm text-slate-400"
      >
        All clear — no active rundowns.
      </div>
    );
  }

  return (
    <div className={styles.darkEmbed}>
      {accounts.map((account) => (
        <article
          key={account.slug}
          data-testid="gantt-charts-card"
          data-account-slug={account.slug}
          className="mb-8 rounded-lg border border-slate-700 bg-slate-900/30 p-4"
        >
          <header className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-100">
              {account.name}
            </h2>
            {account.ganttSeverity ? (
              <AuditBadge severity={account.ganttSeverity} />
            ) : null}
          </header>
          {account.ganttContent}
        </article>
      ))}
    </div>
  );
}
