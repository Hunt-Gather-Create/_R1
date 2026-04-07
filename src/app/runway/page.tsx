import { getClientsWithProjects, getWeekItems, getPipeline, getStaleWeekItems } from "./queries";
import type { ItemStatus, ItemCategory } from "./types";
import { RunwayBoard } from "./runway-board";
import { getMondayISODate, parseISODate } from "./date-utils";
import { analyzeFlags } from "@/lib/runway/flags";

export const metadata = {
  title: "Runway — Civilization Agency",
};

export const dynamic = "force-dynamic";

export default async function RunwayPage() {
  const [clientsWithProjects, allWeekItems, pipelineData, staleItems] = await Promise.all([
    getClientsWithProjects(),
    getWeekItems(),
    getPipeline(),
    getStaleWeekItems(),
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
      target: p.target ?? undefined,
      notes: p.notes ?? undefined,
      staleDays: p.staleDays ?? undefined,
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

  const flags = analyzeFlags(accounts, thisWeek, upcoming, pipelineProps);

  return (
    <RunwayBoard
      thisWeek={thisWeek}
      upcoming={upcoming}
      accounts={accounts}
      pipeline={pipelineProps}
      flags={flags}
      staleItems={staleItems}
    />
  );
}
