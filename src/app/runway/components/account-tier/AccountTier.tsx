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
import { ReadyToCloseChip, NoScheduledTasksChip } from "../section-chips";
import type {
  ClientRundownData,
  RundownSection,
  AnnotatedRow,
} from "@/lib/runway/gantt/types";
import { groupSections } from "@/lib/runway/gantt/group-sections";
import { weekItemsForSection } from "@/lib/runway/gantt/section-builders";
import { CollapsibleSection } from "./CollapsibleSection";
import { L2MiniCard } from "./L2MiniCard";

type Theme = "light" | "dark";

export type AccountForTier = {
  name: string;
  slug: string;
  team: string | null;
  severity: "critical" | "warning" | null;
  sowSigned: boolean | null;
  contractStart: string | null;
  contractEnd: string | null;
  ganttSeverity?: "critical" | "warning" | null;
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

/**
 * Returns the L1 entity id for a section whose raw data is L1-shaped.
 * Wrapper sections (raw.kind === "wrapper") return null since the
 * wrapper itself is not an L1.
 */
function l1IdForSection(section: RundownSection): string | null {
  const raw = section.data.raw;
  return raw.kind === "l1" ? raw.entity.id : null;
}

// `weekItemsForSection` lives in `@/lib/runway/gantt/section-builders` so
// both the By Account view and the Gantt Charts dark embed share the same
// definition of "scheduled tasks" (kind === weekitem, status not terminal).

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
}: {
  section: RundownSection;
  readyToClose: boolean;
  showNoScheduledChip: boolean;
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

  // Empty L1 (no scheduled L2s after status filter): header-only flat row
  // with the inline "No Scheduled Tasks" chip, no <details>.
  if (items.length === 0) {
    return (
      <div
        data-testid="l1-empty"
        className="flex flex-wrap items-center gap-2 py-1 pl-4 border-l border-border"
      >
        <L1Header
          section={section}
          readyToClose={ready}
          showNoScheduledChip
        />
      </div>
    );
  }

  return (
    <CollapsibleSection
      className="pl-4 border-l border-border"
      header={
        <L1Header
          section={section}
          readyToClose={ready}
          showNoScheduledChip={false}
        />
      }
    >
      <div className="flex flex-wrap gap-2 pl-2 pt-2">
        {items.map((wi, index) => (
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
