import { getClientsWithProjects, getWeekItems, getPipeline, getStaleWeekItems } from "./queries";
import type { ItemStatus, ItemCategory } from "./types";
import { RunwayBoard } from "./runway-board";
import { getMondayISODate, parseISODate } from "./date-utils";
import { analyzeFlags } from "@/lib/runway/flags";
import { getViewPreferences } from "@/lib/runway/view-preferences";
import { buildUnifiedAccounts, filterWrapperDayItems } from "./unified-view";

export const metadata = {
  title: "Runway — Civilization Agency",
};

export const dynamic = "force-dynamic";

export default async function RunwayPage() {
  const [clientsWithProjects, allWeekItems, pipelineData, staleItems, viewPrefs] = await Promise.all([
    getClientsWithProjects(),
    getWeekItems(),
    getPipeline(),
    getStaleWeekItems(),
    getViewPreferences(),
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
  const unifiedAccounts = buildUnifiedAccounts(accounts, [...thisWeekFiltered, ...upcomingFiltered]);

  // In Flight regression fix: page-level bucketing for thisWeek/upcoming
  // drops past-Monday day buckets entirely. Multi-week in-progress items
  // whose bucket date is a past Monday were silently disappearing from
  // InFlightSection in prod despite filterInFlight willing to render them.
  // Pass the FULL unfiltered (but wrapper-filtered) source through so In
  // Flight can see every item start/end-bracketed around today.
  const inFlightSource = filterWrapperDayItems(allWeekItems, accounts);

  // Stale wins: items in both Needs Update and In Flight render only in Needs Update.
  // Once updated, they drop from stale and reappear in In Flight on the next render.
  // Pre-fix examples: Bonterra "Impact Report", Soundly "Payment Gateway Page".
  // Post-Commit 4: predicates are mutually exclusive at the row level
  // (In Flight requires today <= endDate; Needs Update requires endDate < today),
  // so a single row cannot satisfy both. Dedup retained as defense-in-depth
  // for multi-row scenarios where the same project has separate rows in
  // both collections (e.g. two scheduled milestones, one past-due, one mid-range).
  const staleProjectIds = new Set<string>(
    staleItems
      .flatMap((day) => day.items.map((item) => item.projectId))
      .filter((id): id is string => Boolean(id))
  );
  const inFlightSourceDeduped = inFlightSource.map((day) => ({
    ...day,
    items: day.items.filter(
      (item) => !item.projectId || !staleProjectIds.has(item.projectId)
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
