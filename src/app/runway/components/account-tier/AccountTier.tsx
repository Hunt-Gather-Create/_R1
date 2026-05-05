/**
 * Track 4 Wave 4.2 — AccountTier tiered swimlane container.
 *
 * Composes Wave 4.1 primitives (CollapsibleSection + L2MiniCard) into a
 * three-level hierarchy per account:
 *
 *   Client  ▶  Wrapper (optional)  ▶  L1  ▶  L2 mini-card row
 *
 * Each level above the L2 row is collapsible. All levels default expanded.
 * Empty L1s (zero weekItems after the active filter) render as a flat
 * header-only row with `(no scheduled L2s)` annotation — no collapse
 * caret since there's nothing to reveal.
 *
 * Filtering is upstream — `rundown` arrives already passed through
 * `filterActiveRundown` in page.tsx (Wave 2). This component does NOT
 * re-filter; it only iterates and renders.
 *
 * This wave does NOT wire the container into account-section.tsx —
 * Wave 4.3 will do that. AccountTier is a free-standing primitive ready
 * to consume.
 */

import type { ReactNode } from "react";
import type {
  ClientRundownData,
  RundownSection,
  AnnotatedRow,
} from "@/lib/runway/gantt/types";
import { groupSections } from "@/lib/runway/gantt/group-sections";
import { CollapsibleSection } from "./CollapsibleSection";
import { L2MiniCard } from "./L2MiniCard";

type Theme = "light" | "dark";

export type AccountForTier = {
  name: string;
  slug: string;
  team: string | null;
  severity: "critical" | "warning" | "ok" | null;
  sowSigned: boolean | null;
  contractStart: string | null;
  contractEnd: string | null;
  ganttSeverity?: "critical" | "warning" | null;
};

type AccountTierProps = {
  account: AccountForTier;
  rundown: ClientRundownData;
  readyToCloseIds: ReadonlySet<string>;
  theme?: Theme;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function formatDateLine(
  startDate: string | null,
  endDate: string | null,
): string | null {
  if (!startDate && !endDate) return null;
  if (startDate && (!endDate || startDate === endDate)) return fmtDate(startDate);
  if (!startDate && endDate) return fmtDate(endDate);
  return `${fmtDate(startDate as string)} – ${fmtDate(endDate as string)}`;
}

/**
 * Sort comparator: ascending by ISO startDate, nulls last. ISO strings
 * (`YYYY-MM-DD`) compare lexicographically, so a sentinel "9999" is past
 * any real date.
 */
function byStartDateNullsLast(a: AnnotatedRow, b: AnnotatedRow): number {
  const ka = a.startDate ?? "9999";
  const kb = b.startDate ?? "9999";
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return 0;
}

/**
 * Returns the L1 entity id for a section whose raw data is L1-shaped.
 * Wrapper sections (raw.kind === "wrapper") return null since the
 * wrapper itself is not an L1.
 */
function l1IdForSection(section: RundownSection): string | null {
  const raw = section.data.raw;
  return raw.kind === "l1" ? raw.entity.id : null;
}

/**
 * Pull weekItem rows out of a section's GanttData. L1-view sections carry
 * their own weekItems as `rows`; wrappers do not (orphan weekItems aside,
 * which we do not surface here).
 */
function weekItemsForSection(section: RundownSection): AnnotatedRow[] {
  return section.data.rows.filter((r) => r.kind === "weekitem");
}

// Track 4 audit fix (2026-05-05, WARN — Panel 3): the inline `groupSections`
// + `SectionBlock` definitions were extracted to
// `@/lib/runway/gantt/group-sections.ts` so AccountTier and RundownContentRSC
// share the algorithm. Drift risk between the two consumers is removed —
// any rule change to wrapper-child grouping lands in one place.

// ─── Sub-components ───────────────────────────────────────────────────────

function ChipBase({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}

function ReadyToCloseChip({ theme }: { theme: Theme }) {
  const cls =
    theme === "dark"
      ? "bg-amber-900/40 text-amber-300"
      : "bg-amber-100 text-amber-800";
  return (
    <ChipBase className={`normal-case ${cls}`} testId="ready-to-close-chip">
      Ready to close?
    </ChipBase>
  );
}

function SeverityBadge({
  severity,
  theme,
}: {
  severity: "critical" | "warning";
  theme: Theme;
}) {
  const isCritical = severity === "critical";
  const cls = isCritical
    ? theme === "dark"
      ? "bg-red-500/20 text-red-300"
      : "bg-red-100 text-red-700"
    : theme === "dark"
      ? "bg-amber-500/20 text-amber-300"
      : "bg-amber-100 text-amber-700";
  return (
    <ChipBase className={cls} testId="client-severity-badge">
      {isCritical ? "Critical" : "Warning"}
    </ChipBase>
  );
}

function SowChip({ theme }: { theme: Theme }) {
  const cls =
    theme === "dark"
      ? "bg-emerald-500/20 text-emerald-300"
      : "bg-emerald-100 text-emerald-700";
  return (
    <ChipBase className={cls} testId="client-sow-chip">
      SOW Signed
    </ChipBase>
  );
}

function WrapperTag({ theme }: { theme: Theme }) {
  const cls =
    theme === "dark"
      ? "bg-slate-800 text-slate-300"
      : "bg-slate-200 text-slate-700";
  return (
    <ChipBase className={cls} testId="wrapper-tag">
      WRAPPER
    </ChipBase>
  );
}

function L1Tag({
  variant,
  theme,
}: {
  variant: "wrapper-child" | "standalone";
  theme: Theme;
}) {
  const cls =
    theme === "dark"
      ? "bg-slate-800 text-slate-400"
      : "bg-slate-100 text-slate-500";
  return (
    <ChipBase className={cls} testId="l1-tag">
      {variant === "wrapper-child" ? "WRAPPER-CHILD" : "STANDALONE L1"}
    </ChipBase>
  );
}

// ─── Headers ──────────────────────────────────────────────────────────────

function ClientHeader({
  account,
  theme,
}: {
  account: AccountForTier;
  theme: Theme;
}) {
  const titleCls =
    theme === "dark"
      ? "font-semibold text-slate-100"
      : "font-semibold text-slate-900";
  const teamCls =
    theme === "dark" ? "text-xs text-slate-400" : "text-xs text-slate-500";
  const dateCls = teamCls;
  const dates = formatDateLine(account.contractStart, account.contractEnd);
  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <span className={titleCls}>{account.name}</span>
      {account.team ? <span className={teamCls}>{account.team}</span> : null}
      {account.severity === "critical" || account.severity === "warning" ? (
        <SeverityBadge severity={account.severity} theme={theme} />
      ) : null}
      {account.sowSigned === true ? <SowChip theme={theme} /> : null}
      {dates ? <span className={dateCls}>{dates}</span> : null}
    </div>
  );
}

function WrapperHeader({
  section,
  theme,
}: {
  section: RundownSection;
  theme: Theme;
}) {
  const titleCls =
    theme === "dark"
      ? "font-medium text-slate-100"
      : "font-medium text-slate-900";
  const dateCls =
    theme === "dark" ? "text-xs text-slate-400" : "text-xs text-slate-500";
  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <span className={titleCls}>{section.title}</span>
      {section.data.headerRange ? (
        <span className={dateCls}>{section.data.headerRange}</span>
      ) : null}
      <WrapperTag theme={theme} />
    </div>
  );
}

function L1Header({
  section,
  variant,
  readyToClose,
  theme,
}: {
  section: RundownSection;
  variant: "wrapper-child" | "standalone";
  readyToClose: boolean;
  theme: Theme;
}) {
  const titleCls =
    theme === "dark"
      ? "font-medium text-slate-100"
      : "font-medium text-slate-900";
  const metaCls =
    theme === "dark" ? "text-xs text-slate-400" : "text-xs text-slate-500";

  // Pull owner / resources off the L1's project row, if available. The
  // section's `raw.entity` is the project row when raw.kind === "l1";
  // typed loosely here because tests fixture the entity narrowly.
  const raw = section.data.raw;
  const entity = raw.kind === "l1" ? (raw.entity as unknown as {
    owner?: string | null;
    resources?: string | null;
  }) : null;
  const owner = entity?.owner ?? null;
  const resources = entity?.resources ?? null;

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <span className={titleCls}>{section.title}</span>
      {readyToClose ? <ReadyToCloseChip theme={theme} /> : null}
      {owner ? <span className={metaCls}>O: {owner}</span> : null}
      {resources ? <span className={metaCls}>{resources}</span> : null}
      {section.data.headerRange ? (
        <span className={metaCls}>{section.data.headerRange}</span>
      ) : null}
      <L1Tag variant={variant} theme={theme} />
    </div>
  );
}

// ─── L1 body ──────────────────────────────────────────────────────────────

function L1Section({
  section,
  variant,
  readyToCloseIds,
  theme,
}: {
  section: RundownSection;
  variant: "wrapper-child" | "standalone";
  readyToCloseIds: ReadonlySet<string>;
  theme: Theme;
}) {
  const items = weekItemsForSection(section).slice().sort(byStartDateNullsLast);
  const id = l1IdForSection(section);
  const ready = id !== null && readyToCloseIds.has(id);

  // Empty L1: header-only flat row with annotation, no <details>.
  if (items.length === 0) {
    const dimCls =
      theme === "dark" ? "text-xs text-slate-500" : "text-xs text-slate-400";
    const indentCls =
      theme === "dark"
        ? "pl-4 border-l border-slate-800"
        : "pl-4 border-l border-slate-100";
    return (
      <div
        data-testid="l1-empty"
        className={`flex flex-wrap items-center gap-2 py-1 ${indentCls}`}
      >
        <L1Header
          section={section}
          variant={variant}
          readyToClose={ready}
          theme={theme}
        />
        <span className={dimCls}>(no scheduled L2s)</span>
      </div>
    );
  }

  const indentCls =
    theme === "dark"
      ? "pl-4 border-l border-slate-800"
      : "pl-4 border-l border-slate-100";

  return (
    <CollapsibleSection
      className={indentCls}
      header={
        <L1Header
          section={section}
          variant={variant}
          readyToClose={ready}
          theme={theme}
        />
      }
    >
      <div className="flex flex-wrap gap-2 pl-2 pt-2">
        {items.map((wi) => (
          <L2MiniCard
            key={wi.id}
            theme={theme}
            weekItem={{
              id: wi.id,
              title: wi.title,
              owner: wi.owner,
              resources: wi.resources,
              startDate: wi.startDate,
              endDate: wi.endDate,
              status: wi.status,
              category: wi.category,
            }}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

function WrapperBlock({
  wrapper,
  childSections,
  readyToCloseIds,
  theme,
}: {
  wrapper: RundownSection;
  childSections: RundownSection[];
  readyToCloseIds: ReadonlySet<string>;
  theme: Theme;
}) {
  const indentCls =
    theme === "dark"
      ? "pl-6 border-l border-slate-700"
      : "pl-6 border-l border-slate-200";
  return (
    <CollapsibleSection
      className={indentCls}
      header={<WrapperHeader section={wrapper} theme={theme} />}
    >
      <div className="space-y-2 pt-2">
        {childSections.map((child) => (
          <L1Section
            key={child.anchor}
            section={child}
            variant="wrapper-child"
            readyToCloseIds={readyToCloseIds}
            theme={theme}
          />
        ))}
      </div>
    </CollapsibleSection>
  );
}

// ─── Top-level component ──────────────────────────────────────────────────

export function AccountTier({
  account,
  rundown,
  readyToCloseIds,
  theme = "light",
}: AccountTierProps) {
  const blocks = groupSections(rundown.sections);

  return (
    <CollapsibleSection
      header={<ClientHeader account={account} theme={theme} />}
    >
      <div className="space-y-3 pt-2">
        {blocks.map((block) => {
          if (block.kind === "wrapper") {
            return (
              <WrapperBlock
                key={block.wrapper.anchor}
                wrapper={block.wrapper}
                childSections={block.children}
                readyToCloseIds={readyToCloseIds}
                theme={theme}
              />
            );
          }
          return (
            <L1Section
              key={block.section.anchor}
              section={block.section}
              variant="standalone"
              readyToCloseIds={readyToCloseIds}
              theme={theme}
            />
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
