/**
 * Track 4 Wave 4.2 + 4.6 — AccountTier tiered swimlane container.
 *
 * Composes Wave 4.1 primitives (CollapsibleSection + L2MiniCard) into a
 * three-level hierarchy per account:
 *
 *   Client  ▶  Wrapper (optional)  ▶  L1  ▶  L2 mini-card row
 *
 * Each level above the L2 row is collapsible. All levels default expanded.
 *
 * Wave 4.6 visual feedback round (operator-locked 2026-05-05):
 *   1. Completed/canceled L2 cards are HIDDEN entirely from the By Account
 *      tab. Filtered out at L1 iteration (the Gantt Charts tab still shows
 *      them per Track 2/3 design).
 *   2. WRAPPER, WRAPPER-CHILD, STANDALONE L1 chips are removed. Users know
 *      L1s as Projects and L2s as Tasks.
 *   3. User-facing copy uses Project/Task vocabulary.
 *   4. Empty L1s render with an inline "No Scheduled Tasks" chip near the
 *      title (replacing the floated "(no scheduled L2s)" annotation).
 *   5. Color classes use design tokens (`text-foreground`,
 *      `text-muted-foreground`, `border-border`) so dark/light auto-flip
 *      via the app's color scheme. The `theme` prop is preserved on the
 *      signature for API stability but no longer drives color.
 *   6. L2 mini-cards now mirror the By Week task card; AccountTier threads
 *      `accountName` through to each card.
 *   7. Null/null date ranges are omitted entirely (no literal "null – null").
 *
 * Filtering is upstream — `rundown` arrives already passed through
 * `filterActiveRundown` in page.tsx (Wave 2). This component only further
 * filters L2 cards by status (correction #1).
 */

import type { ReactNode } from "react";
import { ReadyToCloseChip, NoScheduledTasksChip, AllDoneChip } from "../section-chips";
import type {
  ClientRundownData,
  RundownSection,
  AnnotatedRow,
  L3SectionDisplay,
  SeverityCounts,
} from "@/lib/runway/gantt/types";
import { groupSections } from "@/lib/runway/gantt/group-sections";
import { weekItemsForSection, allWeekItemRowsForSection, l1IdForSection } from "@/lib/runway/gantt/section-builders";
import { CollapsibleSection } from "./CollapsibleSection";
import { L2MiniCard } from "./L2MiniCard";
import { AuditBadge, type AuditIssue } from "../audit-badge";

type Theme = "light" | "dark";

export type AccountForTier = {
  name: string;
  slug: string;
  team: string | null;
  severity: "critical" | "warning" | null;
  sowSigned: boolean | null;
  contractStart: string | null;
  contractEnd: string | null;
  /**
   * Per-account severity rollup (counts of critical / warn / info issues
   * across the active-filtered Gantt rundown). When present, ClientHeader
   * renders the interactive AuditBadge pill (#78) alongside the existing
   * SeverityBadge chip. AuditBadge no-ops on all-zero / info-only counts.
   */
  ganttSeverity?: SeverityCounts;
  /**
   * Per-account issue list backing the AuditBadge expand panel. When
   * present alongside `ganttSeverity`, the badge becomes a clickable
   * button that opens an inline panel listing every contributing issue.
   */
  ganttAuditIssues?: AuditIssue[];
};

type AccountTierProps = {
  account: AccountForTier;
  rundown: ClientRundownData;
  readyToCloseIds: ReadonlySet<string>;
  /**
   * Kept on the signature for API stability — color decisions now flow
   * through design tokens (`text-foreground`, `text-muted-foreground`)
   * which auto-flip via the app's color scheme.
   */
  theme?: Theme;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * Format an inclusive date range. Null/null returns null so callers can
 * skip rendering entirely (correction #7 — no literal "null – null").
 */
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

// `l1IdForSection` and `weekItemsForSection` both live in
// `@/lib/runway/gantt/section-builders` so the By Account view and the
// Gantt Charts dark embed share the same predicates for L1 identity and
// "what counts as a scheduled task."

// ─── Sub-components ───────────────────────────────────────────────────────
//
// `ReadyToCloseChip` + `NoScheduledTasksChip` are imported from
// `../section-chips` (the dark Gantt embed renders the same set, dark
// variant). `SeverityBadge` and `SowChip` are local-only and use
// `ChipBase` below as their primitive.

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

function SeverityBadge({
  severity,
}: {
  severity: "critical" | "warning";
}) {
  const isCritical = severity === "critical";
  const cls = isCritical
    ? "bg-red-500/20 text-red-400"
    : "bg-amber-500/20 text-amber-400";
  return (
    <ChipBase className={cls} testId="client-severity-badge">
      {isCritical ? "Critical" : "Warning"}
    </ChipBase>
  );
}

function SowChip() {
  return (
    <ChipBase
      className="bg-emerald-500/20 text-emerald-400"
      testId="client-sow-chip"
    >
      SOW Signed
    </ChipBase>
  );
}

/**
 * L3 section status chip — reuses the L4 task status vocabulary (plan
 * guardrail: no third enum). Colors mirror the task-status conventions.
 */
const SECTION_STATUS_CLASSES: Record<string, string> = {
  scheduled: "bg-sky-500/20 text-sky-400",
  "in-progress": "bg-violet-500/20 text-violet-400",
  blocked: "bg-red-500/20 text-red-400",
  "at-risk": "bg-amber-500/20 text-amber-400",
  completed: "bg-emerald-500/20 text-emerald-400",
  canceled: "bg-zinc-500/20 text-zinc-400",
};

function SectionStatusChip({ status }: { status: string }) {
  return (
    <ChipBase
      className={SECTION_STATUS_CLASSES[status] ?? "bg-zinc-500/20 text-zinc-400"}
      testId="section-status-chip"
    >
      {status}
    </ChipBase>
  );
}

/**
 * §3.3 render contract — L3 section header band (4-level hierarchy).
 *
 * ONE band per section, always. An actionable section carries its own
 * fields inline on this same band — it never renders as a phantom child
 * task of itself and never splits into "header row + floating task row."
 *
 * Per-field own-value-wins (plan §3.4 guardrail 1): own dates render solid;
 * when own dates are null the derived child rollup renders grayed — even on
 * an otherwise-actionable section. Nothing is stored either way.
 */
/**
 * _R1#105 — the open-task count and the label must agree about what they
 * mean. `weekItemsForSection` correctly drops completed/canceled rows for
 * this active view (that filter is right and stays untouched). But handing
 * that filtered count straight to "N task(s)" makes a FINISHED section
 * ("0 tasks") read identically to a section that never had any rows at all
 * — which reads as a failed import, not completed work.
 *
 * Three distinct facts, three distinct labels:
 *   - openCount > 0        -> "N open"   (there is open work)
 *   - openCount === 0,
 *     totalCount > 0       -> "all done" (rows exist, all terminal)
 *   - totalCount === 0     -> "no tasks" (genuinely empty section)
 */
function formatTaskCountLabel(openCount: number, totalCount: number): string {
  if (totalCount === 0) return "no tasks";
  if (openCount === 0) return "all done";
  return `${openCount} open`;
}

function SectionBand({
  l3,
  openCount,
  totalCount,
}: {
  l3: L3SectionDisplay;
  openCount: number;
  totalCount: number;
}) {
  const hasOwnDates = l3.startDate !== null || l3.endDate !== null;
  const ownDates = formatDateLine(l3.startDate, l3.endDate);
  const derivedDates = formatDateLine(l3.derivedStartDate, l3.derivedEndDate);
  return (
    <div
      data-testid={l3.actionable ? "l3-band-actionable" : "l3-band-grouping"}
      className="flex flex-wrap items-center gap-2"
    >
      <span className="font-medium text-foreground">{l3.title}</span>
      {l3.status ? <SectionStatusChip status={l3.status} /> : null}
      {l3.owner ? (
        <span className="text-xs text-muted-foreground">O: {l3.owner}</span>
      ) : null}
      {l3.resources ? (
        <span className="text-xs text-muted-foreground">{l3.resources}</span>
      ) : null}
      {hasOwnDates && ownDates ? (
        <span data-testid="l3-dates-own" className="text-xs text-foreground">
          {ownDates}
        </span>
      ) : derivedDates ? (
        <span
          data-testid="l3-dates-derived"
          className="text-xs text-muted-foreground/60"
        >
          {derivedDates}
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">
        {formatTaskCountLabel(openCount, totalCount)}
      </span>
    </div>
  );
}

// ─── Headers ──────────────────────────────────────────────────────────────

function ClientHeader({ account }: { account: AccountForTier }) {
  const dates = formatDateLine(account.contractStart, account.contractEnd);
  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <span className="font-semibold text-foreground">{account.name}</span>
      {account.team ? (
        <span className="text-xs text-muted-foreground">{account.team}</span>
      ) : null}
      {account.severity === "critical" || account.severity === "warning" ? (
        <SeverityBadge severity={account.severity} />
      ) : null}
      {account.sowSigned === true ? <SowChip /> : null}
      {/*
        #78 — Audit pill. Same wire-up as gantt-charts-section.tsx; the
        badge no-ops internally on all-zero / info-only counts, so the
        outer guard is a no-op for those cases too.
      */}
      {account.ganttSeverity ? (
        <AuditBadge
          severity={account.ganttSeverity}
          issues={account.ganttAuditIssues}
        />
      ) : null}
      {dates ? (
        <span className="text-xs text-muted-foreground">{dates}</span>
      ) : null}
    </div>
  );
}

function WrapperHeader({ section }: { section: RundownSection }) {
  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <span className="font-medium text-foreground">{section.title}</span>
      {section.data.headerRange ? (
        <span className="text-xs text-muted-foreground">
          {section.data.headerRange}
        </span>
      ) : null}
    </div>
  );
}

function L1Header({
  section,
  readyToClose,
  showNoScheduledChip,
  showAllDoneChip,
}: {
  section: RundownSection;
  readyToClose: boolean;
  showNoScheduledChip: boolean;
  showAllDoneChip: boolean;
}) {
  // Pull owner / resources off the L1's project row, if available. The
  // section's `raw.entity` is the project row when raw.kind === "l1";
  // typed loosely here because tests fixture the entity narrowly.
  const raw = section.data.raw;
  const entity =
    raw.kind === "l1"
      ? (raw.entity as unknown as {
          owner?: string | null;
          resources?: string | null;
          startDate?: string | null;
          endDate?: string | null;
        })
      : null;
  const owner = entity?.owner ?? null;
  const resources = entity?.resources ?? null;

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <span className="font-medium text-foreground">{section.title}</span>
      {readyToClose ? <ReadyToCloseChip /> : null}
      {showNoScheduledChip ? <NoScheduledTasksChip /> : null}
      {showAllDoneChip ? <AllDoneChip /> : null}
      {owner ? (
        <span className="text-xs text-muted-foreground">O: {owner}</span>
      ) : null}
      {resources ? (
        <span className="text-xs text-muted-foreground">{resources}</span>
      ) : null}
      {section.data.headerRange ? (
        <span className="text-xs text-muted-foreground">
          {section.data.headerRange}
        </span>
      ) : null}
    </div>
  );
}

// ─── L1 body ──────────────────────────────────────────────────────────────

/**
 * One-off L1 card (§3.3, 4-level hierarchy): an actionable L1 with no
 * children renders as a first-class childless card — its own status, owner,
 * resources, and dates inline — never the "empty project" shape.
 */
function OneOffCard({ section }: { section: RundownSection }) {
  const raw = section.data.raw;
  const entity =
    raw.kind === "l1"
      ? (raw.entity as unknown as {
          owner?: string | null;
          resources?: string | null;
          startDate?: string | null;
          endDate?: string | null;
          status?: string | null;
        })
      : null;
  const dates = formatDateLine(entity?.startDate ?? null, entity?.endDate ?? null);
  return (
    <div
      data-testid="l1-one-off-card"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 px-4 py-2 ml-4"
    >
      <span className="font-medium text-foreground">{section.title}</span>
      <ChipBase className="bg-sky-500/20 text-sky-400" testId="one-off-chip">
        One-off
      </ChipBase>
      {entity?.status ? (
        <span className="text-xs text-muted-foreground">{entity.status}</span>
      ) : null}
      {entity?.owner ? (
        <span className="text-xs text-muted-foreground">O: {entity.owner}</span>
      ) : null}
      {entity?.resources ? (
        <span className="text-xs text-muted-foreground">{entity.resources}</span>
      ) : null}
      {dates ? (
        <span className="text-xs text-muted-foreground">{dates}</span>
      ) : null}
    </div>
  );
}

function L1Section({
  section,
  readyToCloseIds,
  accountName,
}: {
  section: RundownSection;
  readyToCloseIds: ReadonlySet<string>;
  accountName: string;
}) {
  const items = weekItemsForSection(section).slice().sort(byStartDateNullsLast);
  const id = l1IdForSection(section);
  const ready = id !== null && readyToCloseIds.has(id);
  // #81 — surface the parent L1 project's category to each child card so
  // the dashboard edit modal's read-only "Project category" field can
  // pre-fill from upstream context. Only the "l1" raw shape carries the
  // entity row directly; wrapper sections render their own child sections
  // recursively and pick up parentCategory from their own L1Section pass.
  const l1Category =
    section.data.raw.kind === "l1"
      ? (section.data.raw.entity.category ?? null)
      : null;
  const l1EngagementType =
    section.data.raw.kind === "l1"
      ? (section.data.raw.entity.engagementType ?? null)
      : null;

  // Empty after the status filter. Two different things can be true here,
  // refs _R1#105: the L1 never had any weekItems, or it had weekItems and
  // every one of them is now completed or canceled. weekItemsForSection
  // alone cannot tell those apart, since it filters terminal rows out
  // either way, so allWeekItemRowsForSection below checks the unfiltered
  // count.
  //
  // 4-level hierarchy (§3.3): a one-off L1 is a first-class childless card,
  // not "empty project" UI — its actionable fields render inline.
  let allDone = false;
  if (items.length === 0) {
    if (l1EngagementType === "one-off") {
      return <OneOffCard section={section} />;
    }
    allDone = allWeekItemRowsForSection(section).length > 0;

    // Issue #41: an L1 with no scheduled items EVER has nothing to be
    // ready-to-close on, so the chip stays suppressed and the L1 stays
    // collapsed. That suppression was only ever correct for the genuinely
    // empty case. Issue #105: an L1 whose items are all completed or
    // canceled is not the same case. It has a real ready-to-close signal
    // and real children to show, so it falls through to the shared render
    // path below instead of returning here. "All Done" plus "Ready to
    // close?" on the same L1 is coherent, not a contradiction, and both
    // chips are allowed to render together in that state.
    if (!allDone) {
      return (
        <div
          data-testid="l1-empty"
          className="flex flex-wrap items-center gap-2 py-1 pl-4 border-l border-border"
        >
          <L1Header
            section={section}
            readyToClose={false}
            showNoScheduledChip
            showAllDoneChip={false}
          />
        </div>
      );
    }
  }

  const displayItems = allDone
    ? allWeekItemRowsForSection(section).slice().sort(byStartDateNullsLast)
    : items;

  // §3.3 render order inside a project: L3 sections in sortOrder (each with
  // its tasks), then loose tasks (null sectionId) LAST — legacy flat-list
  // data never interleaves inside the L3 grouping. Projects with zero
  // sections fall back to the flat list unchanged.
  const l3s = section.l3Sections ?? [];
  const itemsByL3 = new Map<string, AnnotatedRow[]>();
  const looseItems: AnnotatedRow[] = [];
  for (const wi of displayItems) {
    const sid = wi.kind === "weekitem" ? wi.sectionId : null;
    if (sid && l3s.some((s) => s.id === sid)) {
      const arr = itemsByL3.get(sid);
      if (arr) arr.push(wi);
      else itemsByL3.set(sid, [wi]);
    } else {
      looseItems.push(wi);
    }
  }

  // _R1#105 — the label needs a fact `weekItemsForSection` doesn't carry:
  // whether the section has ANY rows at all, terminal or not. That's the
  // difference between "all done" (rows exist, all completed/canceled) and
  // "no tasks" (genuinely nothing was ever scheduled here). We deliberately
  // do NOT change the filter — we count the unfiltered rows from
  // `section.data.rows` separately, purely for the label.
  const totalCountByL3 = new Map<string, number>();
  for (const row of section.data.rows) {
    if (row.kind !== "weekitem") continue;
    const sid = row.sectionId;
    if (!sid) continue;
    totalCountByL3.set(sid, (totalCountByL3.get(sid) ?? 0) + 1);
  }

  const renderCards = (rows: AnnotatedRow[]) => (
    <div className="flex flex-wrap gap-2 pl-2 pt-2">
      {rows.map((wi, index) => (
        // Track 4 audit fix (2026-05-05, WARN — Panel 5, Edge Cases):
        // empty-string or duplicate ids in upstream weekItem data would
        // collide on `key={wi.id}` and trigger React's duplicate-key
        // warning + DOM reuse. Fall back to a positional sentinel so
        // each card gets a unique key even when ids are malformed.
        <L2MiniCard
          key={wi.id || `l2-fallback-${index}`}
          accountName={accountName}
          weekItem={{
            id: wi.id,
            title: wi.title,
            owner: wi.owner,
            resources: wi.resources,
            startDate: wi.startDate,
            endDate: wi.endDate,
            status: wi.status,
            category: wi.category,
            // P1.3 (TP review on b7c89f3): notes flows through the
            // GanttRow weekitem variant + AnnotatedRow; parent project
            // name is the section title — every L1Section's items are
            // children of the project the section represents.
            notes: wi.kind === "weekitem" ? wi.notes : null,
            parentProjectName: section.title,
            parentCategory: l1Category,
            // #70 commit 8b — projectId powers the modal's project
            // picker. Same source as notes (per-row WeekItemRow field
            // surfaced via the GanttRow weekitem variant).
            projectId: wi.kind === "weekitem" ? wi.projectId : null,
          }}
        />
      ))}
    </div>
  );

  return (
    <CollapsibleSection
      className="pl-4 border-l border-border"
      header={
        <L1Header
          section={section}
          readyToClose={ready}
          showNoScheduledChip={false}
          showAllDoneChip={allDone}
        />
      }
    >
      {l3s.length === 0 ? (
        renderCards(displayItems)
      ) : (
        <div className="space-y-2 pt-2">
          {l3s.map((l3) => {
            const l3Items = itemsByL3.get(l3.id) ?? [];
            const totalCount = totalCountByL3.get(l3.id) ?? 0;
            return (
              <div key={l3.id} className="pl-2">
                <SectionBand l3={l3} openCount={l3Items.length} totalCount={totalCount} />
                {l3Items.length > 0 ? renderCards(l3Items) : null}
              </div>
            );
          })}
          {looseItems.length > 0 ? (
            <div className="pl-2" data-testid="l3-loose-tasks">
              {renderCards(looseItems)}
            </div>
          ) : null}
        </div>
      )}
    </CollapsibleSection>
  );
}

function WrapperBlock({
  wrapper,
  childSections,
  readyToCloseIds,
  accountName,
}: {
  wrapper: RundownSection;
  childSections: RundownSection[];
  readyToCloseIds: ReadonlySet<string>;
  accountName: string;
}) {
  return (
    <CollapsibleSection
      className="pl-6 border-l border-border"
      header={<WrapperHeader section={wrapper} />}
    >
      <div className="space-y-2 pt-2">
        {childSections.map((child) => (
          <L1Section
            key={child.anchor}
            section={child}
            readyToCloseIds={readyToCloseIds}
            accountName={accountName}
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
}: AccountTierProps) {
  const blocks = groupSections(rundown.sections);

  return (
    <CollapsibleSection header={<ClientHeader account={account} />}>
      <div className="space-y-3 pt-2">
        {blocks.map((block) => {
          if (block.kind === "wrapper") {
            // #42 — a wrapper section with zero renderable L1 children is a
            // visual dead zone (only the WrapperHeader renders). Skip it.
            // The Gantt embed still renders the wrapper rollup including
            // any direct WIs (#65); this filter is AccountTier-local.
            if (block.children.length === 0) return null;
            return (
              <WrapperBlock
                key={block.wrapper.anchor}
                wrapper={block.wrapper}
                childSections={block.children}
                readyToCloseIds={readyToCloseIds}
                accountName={account.name}
              />
            );
          }
          return (
            <L1Section
              key={block.section.anchor}
              section={block.section}
              readyToCloseIds={readyToCloseIds}
              accountName={account.name}
            />
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
