import type { ReactNode } from "react";
import { getClientsWithProjects, getWeekItems, getPipeline, getStaleWeekItems } from "../queries";
import type { ItemStatus, ItemCategory } from "../types";
import { RunwayBoard } from "../runway-board";
import { getMondayISODate, parseISODate } from "../date-utils";
import { analyzeFlags } from "@/lib/runway/flags";
import { getViewPreferences } from "@/lib/runway/view-preferences";
import { buildUnifiedAccounts, filterWrapperDayItems } from "../unified-view";
import { extractClientRundown } from "@/lib/runway/gantt/server";
import { getRunwayDb } from "@/lib/db/runway";
import { clients as clientsTable, projects as projectsTable } from "@/lib/db/runway-schema";
import { and, asc, inArray, isNull } from "drizzle-orm";
import { filterActiveRundown, isReadyToClose } from "@/lib/runway/gantt/filter-active";
import { withRunwayRetry } from "@/lib/runway/retry";
import { RundownContentRSC } from "../components/rundown-content-rsc";
import { TERMINAL_ITEM_STATUSES } from "@/lib/runway/operations-utils";
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
function computeReadyToCloseIds(
  sections: readonly RundownSection[],
  todayISO: string,
): Set<string> {
  const ids = new Set<string>();
  for (const section of sections) {
    const raw = section.data.raw;
    if (raw.kind !== "l1") continue;
    // dashboard-cleanup item 9: pass todayISO so Branch B (0 weekItems +
    // past endDate) can compare without calling `new Date()` on every L1.
    if (isReadyToClose(raw.entity, raw.children, todayISO)) {
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
 *
 * Perf (Qodo P1 #1): the previous implementation awaited per-client DB
 * work inside a for-loop, creating an O(N) async waterfall that scaled
 * linearly with client count. We now (1) fetch top-level projects for
 * ALL clients in a single batched query using inArray() and group them
 * by clientId in-memory, and (2) fan out the per-client
 * extractClientRundown() calls in parallel via Promise.all. This removes
 * the N+1 on top-level lookups AND the sequential await chain.
 */
async function getClientRundowns(): Promise<Map<string, ClientRundownData>> {
  const db = getRunwayDb();
  const todayISO = new Date().toISOString().slice(0, 10);
  const generatedAt = todayISO;

  const allClients = await withRunwayRetry(
    () => db.select().from(clientsTable),
    "getClientRundowns:clients",
  );
  if (allClients.length === 0) return new Map<string, ClientRundownData>();

  const clientIds = allClients.map((c) => c.id);

  // Single batched query for ALL top-level projects across every client,
  // ordered by name. We then bucket them by clientId so each client gets
  // its own ordered list — matching the per-client query shape the
  // for-loop produced, just without the N round-trips.
  const allTopLevels = await withRunwayRetry(
    () =>
      db
        .select()
        .from(projectsTable)
        .where(
          and(inArray(projectsTable.clientId, clientIds), isNull(projectsTable.parentProjectId)),
        )
        .orderBy(asc(projectsTable.name)),
    "getClientRundowns:topLevels",
  );

  type TopLevelRow = (typeof allTopLevels)[number];
  const topLevelsByClient = new Map<string, TopLevelRow[]>();
  for (const row of allTopLevels) {
    const bucket = topLevelsByClient.get(row.clientId);
    if (bucket) {
      bucket.push(row);
    } else {
      topLevelsByClient.set(row.clientId, [row]);
    }
  }

  // Fan out extractClientRundown across all clients in parallel.
  const entries = await Promise.all(
    allClients.map(async (client) => {
      const topLevels = topLevelsByClient.get(client.id) ?? [];
      const rundown = await extractClientRundown(db, client, topLevels, generatedAt, todayISO);
      return [client.id, rundown] as const;
    }),
  );

  return new Map<string, ClientRundownData>(entries);
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

  // Compute once so all downstream callers share the same "today" value
  // for date comparisons (isReadyToClose branch B, etc.).
  const todayISO = new Date().toISOString().slice(0, 10);

  // Split week items into thisWeek and upcoming in a single pass.
  //
  // Issue #4 (WeekOf display gap): filter terminal-status L2s
  // (completed/canceled) out before bucketing. This mirrors the upstream
  // filter applied to the By Account view (rundown layer +
  // `weekItemsForSection` in section-builders.ts) so the two surfaces
  // stay consistent on terminal items. Days that drain to zero after
  // filtering are dropped entirely so we don't render empty day headers.
  const currentWeekOf = getMondayISODate(new Date());

  const thisWeek: typeof allWeekItems = [];
  const upcoming: typeof allWeekItems = [];

  for (const day of allWeekItems) {
    const filteredItems = day.items.filter(
      (item) => !(TERMINAL_ITEM_STATUSES as readonly string[]).includes(item.status ?? ""),
    );
    if (filteredItems.length === 0) continue;
    const dayFiltered = { ...day, items: filteredItems };
    const itemMonday = getMondayISODate(parseISODate(day.date));
    if (itemMonday === currentWeekOf) {
      thisWeek.push(dayFiltered);
    } else if (itemMonday > currentWeekOf) {
      upcoming.push(dayFiltered);
    }
  }

  // Map DB shape to component props
  //
  // Track 4 audit fix (2026-05-05): surface client-level contract dates on the
  // By Account header. Contract dates live on the retainer wrapper L1
  // (`projects.contract_start` / `projects.contract_end`) per the v4 retainer
  // convention. We pluck them from the wrapper project — the L1 in the
  // account's items whose id is referenced by another L1's `parentProjectId`
  // AND whose own `engagementType === "retainer"`. Standalone L1s and
  // project-only accounts carry no canonical contract dates → both fields
  // remain null.
  const accounts = clientsWithProjects.map((client) => {
    const referencedAsParent = new Set(
      client.items
        .map((p) => p.parentProjectId)
        .filter((pid): pid is string => Boolean(pid)),
    );
    const wrapper = client.items.find(
      (p) => p.engagementType === "retainer" && referencedAsParent.has(p.id),
    );
    return {
      name: client.name,
      slug: client.slug,
      contractValue: client.contractValue ?? undefined,
      contractTerm: client.contractTerm ?? undefined,
      contractStatus: (client.contractStatus ?? "signed") as
        | "signed"
        | "unsigned"
        | "expired",
      contractStart: wrapper?.contractStart ?? null,
      contractEnd: wrapper?.contractEnd ?? null,
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
    };
  });

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
        ? computeReadyToCloseIds(filtered.sections, todayISO)
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
      initialNeedsUpdateEnabled={viewPrefs.needsUpdateToggle ?? true}
      inFlightSource={inFlightSourceDeduped}
    />
  );
}
