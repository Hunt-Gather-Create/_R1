import type { ReactNode } from "react";
import { getClientsWithProjects, getWeekItems, getPipeline, getStaleWeekItems } from "./queries";
import type { ItemStatus, ItemCategory } from "./types";
import { RunwayBoard } from "./runway-board";
import { getMondayISODate, parseISODate } from "./date-utils";
import { analyzeFlags } from "@/lib/runway/flags";
import { getViewPreferences } from "@/lib/runway/view-preferences";
import { buildUnifiedAccounts, filterWrapperDayItems } from "./unified-view";
import { extractClientRundown } from "@/lib/runway/gantt/server";
import { getRunwayDb } from "@/lib/db/runway";
import { clients as clientsTable, projects as projectsTable } from "@/lib/db/runway-schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { filterActiveRundown, isReadyToClose } from "@/lib/runway/gantt/filter-active";
import { RundownContentRSC } from "./components/rundown-content-rsc";
import type { ClientRundownData, RundownSection } from "@/lib/runway/gantt/types";

/**
 * Track 3 Wave 5: precompute the set of L1 ids that are "ready to close"
 * for a given filtered rundown. An L1 is ready-to-close when every
 * weekItem under it is `status === "completed"` AND the L1 itself is not
 * yet in {completed, canceled}. Operator-locked rule (2026-05-04):
 * surface this in BOTH By Account info-cards AND Gantt Charts embeds.
 *
 * Wrapper-children and standalone L1s both expose `raw.kind === "l1"`
 * with `entity` (the L1 ProjectRow) and `children` (its weekItems). We
 * iterate every section once and collect ids whose isReadyToClose() is
 * true. The wrapper itself (`raw.kind === "wrapper"`) does NOT carry
 * weekItem statuses at the rundown layer — it surfaces a chip only if
 * every CHILD L1 under it is itself ready-to-close, which the per-row
 * chip already conveys. So wrapper rows are excluded from the set.
 */
function computeReadyToCloseIds(sections: readonly RundownSection[]): Set<string> {
  const ids = new Set<string>();
  for (const section of sections) {
    const raw = section.data.raw;
    if (raw.kind !== "l1") continue;
    if (isReadyToClose(raw.entity, raw.children)) {
      ids.add(raw.entity.id);
    }
  }
  return ids;
}

/**
 * Track 2: build a Map<clientId, ClientRundownData> for all clients.
 * Called from Promise.all in RunwayPage so the rundown fetch parallelizes
 * with the other top-level queries.
 *
 * Track 3 Wave 3: rundowns are still extracted here so Wave 4 can reuse
 * them on a separate "Gantt Charts" tab. The By Account tab no longer
 * renders Gantt embeds, but the rundown drives the active-status filter
 * that hides accounts whose work has all completed/canceled.
 */
async function getClientRundowns(): Promise<Map<string, ClientRundownData>> {
  const db = getRunwayDb();
  const todayISO = new Date().toISOString().slice(0, 10);
  const generatedAt = todayISO;

  const allClients = await db.select().from(clientsTable);
  const result = new Map<string, ClientRundownData>();
  for (const client of allClients) {
    const topLevels = await db
      .select()
      .from(projectsTable)
      .where(
        and(eq(projectsTable.clientId, client.id), isNull(projectsTable.parentProjectId)),
      )
      .orderBy(asc(projectsTable.name));
    const rundown = await extractClientRundown(db, client, topLevels, generatedAt, todayISO);
    result.set(client.id, rundown);
  }
  return result;
}

export const metadata = {
  title: "Runway — Civilization Agency",
};

export const dynamic = "force-dynamic";

export default async function RunwayPage() {
  const [
    clientsWithProjects,
    allWeekItems,
    pipelineData,
    staleItems,
    viewPrefs,
    clientRundowns,
  ] = await Promise.all([
    getClientsWithProjects(),
    getWeekItems(),
    getPipeline(),
    getStaleWeekItems(),
    getViewPreferences(),
    getClientRundowns(),
  ]);

  // Split week items into thisWeek and upcoming in a single pass
  const currentWeekOf = getMondayISODate(new Date());

  const thisWeek: typeof allWeekItems = [];
  const upcoming: typeof allWeekItems = [];

  for (const day of allWeekItems) {
    const itemMonday = getMondayISODate(parseISODate(day.date));
    if (itemMonday === currentWeekOf) {
      thisWeek.push(day);
    } else if (itemMonday > currentWeekOf) {
      upcoming.push(day);
    }
  }

  // Map DB shape to component props
  const accounts = clientsWithProjects.map((client) => ({
    name: client.name,
    slug: client.slug,
    contractValue: client.contractValue ?? undefined,
    contractTerm: client.contractTerm ?? undefined,
    contractStatus: (client.contractStatus ?? "signed") as
      | "signed"
      | "unsigned"
      | "expired",
    team: client.team ?? undefined,
    items: client.items.map((p) => ({
      id: p.id,
      title: p.name,
      status: (p.status ?? "not-started") as ItemStatus,
      category: (p.category ?? "active") as ItemCategory,
      owner: p.owner ?? undefined,
      resources: p.resources ?? undefined,
      waitingOn: p.waitingOn ?? undefined,
      notes: p.notes ?? undefined,
      staleDays: p.staleDays ?? undefined,
      // v4 timing + retainer metadata (chunk 3 #4, #5)
      startDate: p.startDate ?? null,
      endDate: p.endDate ?? null,
      engagementType: (p.engagementType ?? null) as
        | "project"
        | "retainer"
        | "break-fix"
        | null,
      contractEnd: p.contractEnd ?? null,
      updatedAt: p.updatedAt?.toISOString() ?? null,
      // v4 (PR #88 Chunk F): retainer wrapper linkage.
      parentProjectId: p.parentProjectId ?? null,
    })),
  }));

  const pipelineProps = pipelineData.map((p) => ({
    account: p.accountName ?? "",
    title: p.name,
    value: p.estimatedValue ?? "TBD",
    status: (p.status ?? "drafting") as
      | "scoping"
      | "drafting"
      | "sow-sent"
      | "verbal"
      | "signed"
      | "at-risk",
    owner: p.owner ?? undefined,
    waitingOn: p.waitingOn ?? undefined,
    notes: p.notes ?? undefined,
  }));

  // Strip any DayItemEntries whose projectId points at a retainer
  // wrapper. Defensive filter — wrappers are umbrella projects and
  // their direct milestones (if any) shouldn't surface in Week view.
  // Applied BEFORE analyzeFlags so detectors don't count wrapper L2s.
  const thisWeekFiltered = filterWrapperDayItems(thisWeek, accounts);
  const upcomingFiltered = filterWrapperDayItems(upcoming, accounts);

  const flags = analyzeFlags(accounts, thisWeekFiltered, upcomingFiltered, pipelineProps);

  // Chunk 3 #1 — unified Project View. Group L2s under their parent L1
  // from the same combined fetch so By-Account renders milestones inline.
  const unifiedBase = buildUnifiedAccounts(accounts, [...thisWeekFiltered, ...upcomingFiltered]);

  // Track 3 Wave 3: drop accounts whose Gantt rundown has zero active
  // sections after applying the active-status filter (completed/canceled
  // L1s + their wrappers are hidden). Accounts without a rundown row in
  // the map (data-integrity nudge) stay visible.
  //
  // Track 3 Wave 4: for surviving accounts that DO have a rundown, also
  // pre-render the dark Gantt embed via RundownContentRSC and attach it
  // as `ganttContent`. This ReactNode is consumed by GanttChartsSection
  // on the Gantt Charts tab. AccountSection (By Account tab) ignores
  // it — same data, two affordances.
  const unifiedAccounts = unifiedBase
    .map((account) => {
      const clientEntry = clientsWithProjects.find((c) => c.slug === account.slug);
      if (!clientEntry) return { account, filtered: null as ClientRundownData | null };
      const rundown = clientRundowns.get(clientEntry.id);
      if (!rundown) return { account, filtered: null as ClientRundownData | null };
      const filtered = filterActiveRundown(rundown);
      return { account, filtered };
    })
    .filter(({ filtered }) => {
      if (filtered === null) return true; // no rundown row → keep visible
      return filtered.sections.length > 0;
    })
    .map(({ account, filtered }) => {
      // Track 3 Wave 5: compute the per-account "ready to close?" L1 id
      // set ONCE here, then thread it through to both the By Account
      // info-card (via account.readyToCloseIds) AND the Gantt Charts
      // embed (via RundownContentRSC's prop). Operator-locked: same
      // signal must appear in both views.
      const readyToCloseIds = filtered
        ? computeReadyToCloseIds(filtered.sections)
        : new Set<string>();
      const ganttContent: ReactNode | undefined = filtered
        ? (
          <RundownContentRSC
            sections={filtered.sections}
            readyToCloseIds={readyToCloseIds}
          />
        )
        : undefined;
      const ganttSeverity = filtered?.overallSeverity;
      // Track 4 Wave 4.3: also carry the raw filtered rundown so the new
      // By Account tier (`<AccountTier ...>`) can iterate it directly. The
      // Gantt Charts tab continues to read `ganttContent` (a ReactNode);
      // both views are driven by the same upstream filter result.
      return {
        ...account,
        rundown: filtered,
        ganttContent,
        ganttSeverity,
        readyToCloseIds,
      };
    });

  // In Flight regression fix: page-level bucketing for thisWeek/upcoming
  // drops past-Monday day buckets entirely. Multi-week in-progress items
  // whose bucket date is a past Monday were silently disappearing from
  // InFlightSection in prod despite filterInFlight willing to render them.
  // Pass the FULL unfiltered (but wrapper-filtered) source through so In
  // Flight can see every item start/end-bracketed around today.
  const inFlightSource = filterWrapperDayItems(allWeekItems, accounts);

  // Dedup belt-and-suspenders: post-Commit 4, the same row can't appear in both
  // sections (predicates are mutually exclusive). ID-based dedup catches the
  // original same-row duplication bug if it ever recurs, without punishing
  // active sibling rows in the same project.
  //
  // Real example: HDL "Website Build" has multiple parallel L2s in flight
  // (Batch 1 Design, Batch 2 Design, Final Review). When Batch 1 Design goes
  // overdue, project-id dedup would have hidden ALL of Website Build from In
  // Flight — wrong, because Batch 2 and Final Review are still actively in
  // flight. ID-based dedup keeps each row in its correct section.
  const staleItemIds = new Set<string>(
    staleItems
      .flatMap((day) => day.items.map((item) => item.id))
      .filter((id): id is string => Boolean(id))
  );
  const inFlightSourceDeduped = inFlightSource.map((day) => ({
    ...day,
    items: day.items.filter(
      (item) => !item.id || !staleItemIds.has(item.id)
    ),
  }));

  return (
    <RunwayBoard
      thisWeek={thisWeekFiltered}
      upcoming={upcomingFiltered}
      accounts={unifiedAccounts}
      pipeline={pipelineProps}
      flags={flags}
      staleItems={staleItems}
      initialInFlightEnabled={viewPrefs.inFlightToggle ?? true}
      inFlightSource={inFlightSourceDeduped}
    />
  );
}
