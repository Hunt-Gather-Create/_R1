// TODO: Re-enable auth when deployed to Vercel (WorkOS callback is port-bound)
import { getClientsWithProjects, getWeekItems, getPipeline } from "./queries";
import type { ItemStatus, ItemCategory } from "./types";
import { RunwayBoard } from "./runway-board";
import { getMondayISODate, parseISODate } from "./date-utils";

export const metadata = {
  title: "Runway — Civilization Agency",
};

export const dynamic = "force-dynamic";

export default async function RunwayPage() {
  const [clientsWithProjects, allWeekItems, pipelineData] = await Promise.all([
    getClientsWithProjects(),
    getWeekItems(),
    getPipeline(),
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
    status: (p.status ?? "no-sow") as
      | "sow-sent"
      | "drafting"
      | "no-sow"
      | "verbal",
    waitingOn: p.waitingOn ?? undefined,
    notes: p.notes ?? undefined,
  }));

  return (
    <RunwayBoard
      thisWeek={thisWeek}
      upcoming={upcoming}
      accounts={accounts}
      pipeline={pipelineProps}
    />
  );
}
