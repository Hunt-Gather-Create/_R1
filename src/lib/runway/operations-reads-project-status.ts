/**
 * Runway Read Operations — project status drill-down.
 *
 * Powers the bot's `get_project_status` tool: returns a structured summary
 * of one L1 engagement for human-friendly narration. Shape is consumed by
 * Chunk 3 UI, so treat `ProjectStatus` as an interface contract.
 *
 * @see docs/tmp/cc-prompts/cc-prompt-chunk-2-pr86.md "Interface contract"
 * @see docs/tmp/runway-v4-convention.md
 */

import { getRunwayDb } from "@/lib/db/runway";
import {
  projects,
  weekItems,
  updates,
  clients,
} from "@/lib/db/runway-schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { getClientOrFail, resolveProjectOrFail } from "./operations-utils";
import { chicagoISODate } from "./operations-reads-week";

export type ProjectStatusEnum =
  | "in-production"
  | "awaiting-client"
  | "not-started"
  | "blocked"
  | "on-hold"
  | "completed"
  | (string & {}); // allow unknown values to pass through without type error

export type EngagementType = "project" | "retainer" | "break-fix" | null;

export interface ProjectStatusWeekItem {
  id: string;
  title: string;
  status: string | null;
  category: string | null;
  startDate: string | null;
  endDate: string | null;
  owner: string | null;
  resources: string | null;
  notes: string | null;
  blockedBy: string | null;
}

export interface ProjectStatusUpdate {
  id: string;
  updateType: string | null;
  summary: string | null;
  previousValue: string | null;
  newValue: string | null;
  updatedBy: string | null;
  createdAt: string | null;
}

export interface ProjectStatus {
  name: string;
  client: string;
  owner: string;
  status: ProjectStatusEnum;
  engagement_type: EngagementType;
  contractRange: { start?: string; end?: string };
  current: {
    waitingOn?: string;
    blockers?: string[];
  };
  inFlight: ProjectStatusWeekItem[];
  upcoming: ProjectStatusWeekItem[];
  team: string;
  recentUpdates: ProjectStatusUpdate[];
  suggestedActions: string[];
}

export interface GetProjectStatusParams {
  clientSlug: string;
  projectName: string;
  /** Override the current date. Used by tests. */
  now?: Date;
}

export type GetProjectStatusResult =
  | { ok: true; status: ProjectStatus }
  | { ok: false; error: string; available?: string[] };

function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function toStatusWeekItem(item: typeof weekItems.$inferSelect): ProjectStatusWeekItem {
  return {
    id: item.id,
    title: item.title,
    status: item.status ?? null,
    category: item.category ?? null,
    startDate: item.startDate ?? item.date ?? null,
    endDate: item.endDate ?? null,
    owner: item.owner ?? null,
    resources: item.resources ?? null,
    notes: item.notes ?? null,
    blockedBy: item.blockedBy ?? null,
  };
}

function toStatusUpdate(u: typeof updates.$inferSelect): ProjectStatusUpdate {
  return {
    id: u.id,
    updateType: u.updateType,
    summary: u.summary,
    previousValue: u.previousValue,
    newValue: u.newValue,
    updatedBy: u.updatedBy,
    createdAt: u.createdAt ? u.createdAt.toISOString() : null,
  };
}

/**
 * Determine whether a week item is "in flight" right now — i.e. today falls
 * within [startDate, endDate], with single-day items treated as endDate=startDate.
 */
function isInFlight(item: ProjectStatusWeekItem, todayISO: string): boolean {
  if (item.status !== "in-progress") return false;
  const start = item.startDate;
  if (!start) return false;
  const end = item.endDate ?? start;
  return start <= todayISO && todayISO <= end;
}

/** Whether an item is upcoming within the next `windowDays` calendar days. */
function isUpcoming(
  item: ProjectStatusWeekItem,
  todayISO: string,
  windowEndISO: string
): boolean {
  if (item.status === "completed") return false;
  const start = item.startDate;
  if (!start) return false;
  return start >= todayISO && start <= windowEndISO;
}

/**
 * Derive short, actionable suggestions for the bot to surface.
 * Pure heuristic — deterministic, no LLM calls.
 */
function deriveSuggestedActions(
  project: typeof projects.$inferSelect,
  items: ProjectStatusWeekItem[],
  todayISO: string
): string[] {
  const out: string[] = [];

  // Any L2 past its end_date while still in-progress?
  const overdueInProgress = items.filter((i) => {
    if (i.status !== "in-progress") return false;
    const end = i.endDate ?? i.startDate;
    if (!end) return false;
    return end < todayISO;
  });
  for (const i of overdueInProgress) {
    out.push(`review status on "${i.title}" — past end_date with status still in-progress`);
  }

  // Any L2 marked blocked?
  const blocked = items.filter((i) => i.status === "blocked");
  for (const i of blocked) {
    out.push(`unblock "${i.title}" (currently blocked)`);
  }

  // Project-level hints
  if (project.status === "awaiting-client" && !project.waitingOn) {
    out.push("set waitingOn so the bot can nudge the right person");
  }
  if (project.engagementType === "retainer" && project.contractEnd) {
    const thirty = addDaysISO(todayISO, 30);
    if (project.contractEnd >= todayISO && project.contractEnd <= thirty) {
      out.push(`retainer renewal due by ${project.contractEnd} — kick off a conversation`);
    }
  }

  // If there are no in-flight items but project is in-production, nudge.
  const hasInFlight = items.some((i) => isInFlight(i, todayISO));
  if (project.status === "in-production" && !hasInFlight && items.length > 0) {
    out.push("no L2 is currently in-flight — move the next milestone to in-progress or update status");
  }

  return out;
}

export async function getProjectStatus(
  params: GetProjectStatusParams
): Promise<GetProjectStatusResult> {
  const { clientSlug, projectName, now = new Date() } = params;

  const clientLookup = await getClientOrFail(clientSlug);
  if (!clientLookup.ok) return { ok: false, error: clientLookup.error };
  const client = clientLookup.client;

  const projectLookup = await resolveProjectOrFail(client.id, client.name, projectName);
  if (!projectLookup.ok) return projectLookup;
  const project = projectLookup.project;

  const db = getRunwayDb();

  // Parallel: L2s for the project + recent updates + fresh client row (for team/contract).
  const [l2rows, recentUpdates] = await Promise.all([
    db
      .select()
      .from(weekItems)
      .where(eq(weekItems.projectId, project.id))
      .orderBy(asc(weekItems.date), asc(weekItems.sortOrder)),
    db
      .select()
      .from(updates)
      .where(and(eq(updates.projectId, project.id)))
      .orderBy(desc(updates.createdAt))
      .limit(3),
  ]);

  const todayISO = chicagoISODate(now);
  const fourteenDaysOutISO = addDaysISO(todayISO, 14);

  const statusItems = l2rows.map(toStatusWeekItem);

  const inFlight = statusItems.filter((i) => isInFlight(i, todayISO));
  const upcoming = statusItems
    .filter((i) => !isInFlight(i, todayISO) && isUpcoming(i, todayISO, fourteenDaysOutISO))
    .sort((a, b) => {
      const aStart = a.startDate ?? "";
      const bStart = b.startDate ?? "";
      return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
    });

  // Blockers: titles of status=blocked L2s, plus any items referenced in blocked_by.
  const blockerTitles = statusItems.filter((i) => i.status === "blocked").map((i) => i.title);
  // Resolve blocked_by ids into titles if the referenced L2 is within this project's children.
  const byId = new Map(statusItems.map((i) => [i.id, i.title]));
  for (const item of statusItems) {
    if (!item.blockedBy) continue;
    try {
      const ids = JSON.parse(item.blockedBy) as string[];
      for (const bid of ids) {
        const title = byId.get(bid);
        if (title && !blockerTitles.includes(title)) blockerTitles.push(title);
      }
    } catch (err) {
      // Chunk 5 debt §12.3: surface malformed payloads at debug level so ops
      // can spot data-integrity drift without failing the read. Deliberately
      // silent on the user-facing path (the L2's upstream blockers will not
      // surface in blockerTitles, but the response still returns).
      console.warn(JSON.stringify({
        event: "runway_blocked_by_parse_error",
        projectId: project.id,
        weekItemId: item.id,
        rawLength: item.blockedBy.length,
        message: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  // Contract range — prefer explicit contract_start/end (retainer override), else derived start/end.
  const contractRange: ProjectStatus["contractRange"] = {};
  const rangeStart = project.contractStart ?? project.startDate ?? undefined;
  const rangeEnd = project.contractEnd ?? project.endDate ?? undefined;
  if (rangeStart) contractRange.start = rangeStart;
  if (rangeEnd) contractRange.end = rangeEnd;

  const engagementType = (project.engagementType as EngagementType) ?? null;

  // Client row refresh for team + name + contract_status surfacing could happen here,
  // but `client` from fuzzy lookup already has both team and name.
  const clientRow = await db.select().from(clients).where(eq(clients.id, client.id)).get();

  const status: ProjectStatus = {
    name: project.name,
    client: client.name,
    owner: project.owner ?? "",
    status: project.status ?? "not-started",
    engagement_type: engagementType,
    contractRange,
    current: {
      waitingOn: project.waitingOn ?? undefined,
      blockers: blockerTitles.length > 0 ? blockerTitles : undefined,
    },
    inFlight,
    upcoming,
    team: clientRow?.team ?? project.resources ?? "",
    recentUpdates: recentUpdates.map(toStatusUpdate),
    suggestedActions: deriveSuggestedActions(project, statusItems, todayISO),
  };

  return { ok: true, status };
}
