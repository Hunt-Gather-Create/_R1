/**
 * Server component: renders account section with embedded Gantt rundown.
 *
 * GanttTemplate.tsx imports react-dom/server (renderToStaticMarkup) and
 * themes.ts imports Node's fs module. Next.js App Router prohibits importing
 * these in server components (Turbopack restriction). This server component
 * renders GanttSection as RSC JSX (no renderToStaticMarkup call) so the
 * rendering goes through React's SSR pipeline, not a manual render call.
 *
 * The `<details open>` elements provide disclosure without JS — the open
 * attribute works via native HTML. No client JS is needed for the Gantt embed.
 *
 * AccountSectionHeader (client component) handles the interactive header
 * (ContractBadge, AuditBadge) while the Gantt body is server-rendered.
 */

import type { ClientRundownData, RundownSection } from "@/lib/runway/gantt/types";
import { GanttSection } from "@/lib/runway/gantt/GanttTemplate";
import { ContractBadge } from "./status-badge";
import { AuditBadge } from "./audit-badge";
import type { UnifiedAccount } from "../unified-view";
import styles from "./gantt-dark-embed.module.css";

export interface AccountWithRawRundown extends UnifiedAccount {
  rundown: ClientRundownData | null;
}

type SectionBlock =
  | { kind: "wrapper"; wrapper: RundownSection; children: RundownSection[] }
  | { kind: "standalone"; section: RundownSection };

function groupSectionsForAccount(sections: RundownSection[]): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  let currentWrapper: { wrapper: RundownSection; children: RundownSection[] } | null = null;
  for (const s of sections) {
    if (s.kind === "wrapper") {
      if (currentWrapper) blocks.push({ kind: "wrapper", ...currentWrapper });
      currentWrapper = { wrapper: s, children: [] };
    } else if (s.kind === "wrapper-child") {
      if (currentWrapper) {
        currentWrapper.children.push(s);
      } else {
        blocks.push({ kind: "standalone", section: s });
      }
    } else {
      if (currentWrapper) {
        blocks.push({ kind: "wrapper", ...currentWrapper });
        currentWrapper = null;
      }
      blocks.push({ kind: "standalone", section: s });
    }
  }
  if (currentWrapper) blocks.push({ kind: "wrapper", ...currentWrapper });
  return blocks;
}

function formatContractTerm(term?: string): string | undefined {
  if (!term) return undefined;
  return term
    .replace(/\bMSA\b/g, "Master Service Agreement")
    .replace(/\bSOW\b/g, "Statement of Work")
    .replace(/\bNDA\b/g, "Non-Disclosure Agreement");
}

function RundownSectionBody({ rundown }: { rundown: ClientRundownData | null }) {
  if (!rundown || rundown.sections.length === 0) {
    return <p className="py-4 text-sm text-muted-foreground/60">No active projects.</p>;
  }
  const blocks = groupSectionsForAccount(rundown.sections);
  return (
    <div className={`${styles.darkEmbed} space-y-4`} data-testid="rundown-section-list">
      {blocks.map((block) => {
        if (block.kind === "wrapper") {
          return (
            <details
              key={block.wrapper.anchor}
              open
              className="rounded-lg border border-slate-700 bg-slate-900/40 p-3"
            >
              <summary className="cursor-pointer list-none text-sm font-medium text-slate-200">
                {block.wrapper.title}
              </summary>
              <div className="mt-3">
                <GanttSection data={block.wrapper.data} theme="dark-account-view" />
              </div>
              {block.children.map((child) => (
                <details
                  key={child.anchor}
                  open
                  className="ml-4 mt-3 rounded border-l-2 border-slate-700 pl-3"
                >
                  <summary className="cursor-pointer list-none text-xs text-slate-400">
                    {child.title}
                  </summary>
                  <div className="mt-2">
                    <GanttSection data={child.data} theme="dark-account-view" />
                  </div>
                </details>
              ))}
            </details>
          );
        }
        return (
          <details
            key={block.section.anchor}
            open
            className="rounded-lg border border-slate-700/60 bg-slate-900/20 p-3"
          >
            <summary className="cursor-pointer list-none text-sm font-medium text-slate-300">
              {block.section.title}
            </summary>
            <div className="mt-3">
              <GanttSection data={block.section.data} theme="dark-account-view" />
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function AccountSectionServer({ account }: { account: AccountWithRawRundown }) {
  const displayTerm = formatContractTerm(account.contractTerm);

  return (
    <details open className="rounded-xl border border-border bg-card/30">
      <summary className="cursor-pointer list-none p-3 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground sm:text-xl">{account.name}</h3>
            {account.team ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{account.team}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            {displayTerm ? (
              <p className="text-xs text-muted-foreground">{displayTerm}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <ContractBadge status={account.contractStatus} />
              {account.rundown ? (
                <AuditBadge severity={account.rundown.overallSeverity} />
              ) : null}
            </div>
          </div>
        </div>
      </summary>
      <div className="px-3 pb-3 sm:px-5 sm:pb-5">
        <RundownSectionBody rundown={account.rundown} />
      </div>
    </details>
  );
}
