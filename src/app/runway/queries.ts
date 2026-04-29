import { getRunwayDb } from "@/lib/db/runway";
import {
  clients,
  projects,
  weekItems,
  pipelineItems,
} from "@/lib/db/runway-schema";
import { eq, and, gte, lte, lt, or, isNull, isNotNull, asc } from "drizzle-orm";
import type { ClientWithProjects, DayItemType, PipelineRow, WeekDay } from "./types";
import { parseISODate, getMonday, getMondayISODate, toISODateString } from "./date-utils";
import { getClientNameMap, groupBy } from "@/lib/runway/operations";

// ── Shared helpers ──────────────────────────────────────

const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDayLabel(dateStr: string): string {
  const d = parseISODate(dateStr);
  return `${SHORT_DAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

type WeekItemRow = typeof weekItems.$inferSelect;

/**
 * Parse blockedBy JSON array from storage. Returns empty array on null/invalid.
 * Storage shape: `["id1","id2"]`.
 */
function parseBlockedByIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

/**
 * Resolve a week item's blockedBy id list to {id, title, status} refs.
 * Unresolved ids (blocker not in the provided map) are dropped — the UI
 * renders only visible blockers. Callers can still check raw ids if needed.
 *
 * Invariant (Chunk 5 debt §13.3): the `weekItemById` map must contain
 * every L2 the caller needs to resolve — typically the full `items[]`
 * the UI already has in hand. If a caller later scopes the map to a
 * single-week slice, cross-week blockers will silently disappear from
 * the rendered dependency chain. Keep the map's scope at least as wide
 * as the items being rendered to avoid that foot-gun.
 */
function resolveBlockedByRefs(
  raw: string | null | undefined,
  weekItemById: Map<string, WeekItemRow>
): Array<{ id: string; title: string; status?: string | null }> {
  const ids = parseBlockedByIds(raw);
  if (ids.length === 0) return [];
  const refs: Array<{ id: string; title: string; status?: string | null }> = [];
  for (const id of ids) {
    const blocker = weekItemById.get(id);
    if (!blocker) continue;
    refs.push({ id, title: blocker.title, status: blocker.status });
  }
  return refs;
}

function mapWeekItemToEntry(
  item: WeekItemRow,
  clientNameById: Map<string, string>,
  weekItemById: Map<string, WeekItemRow>
): WeekDay["items"][number] {
  const blockedByRefs = resolveBlockedByRefs(item.blockedBy, weekItemById);
  const updatedMs = item.updatedAt ? item.updatedAt.getTime() : null;
  return {
    id: item.id,
    projectId: item.projectId ?? null,
    title: item.title,
    account: item.clientId ? (clientNameById.get(item.clientId) ?? "") : "",
    ...(item.owner ? { owner: item.owner } : {}),
    ...(item.resources ? { resources: item.resources } : {}),
    type: (item.category ?? "delivery") as DayItemType,
    ...(item.notes ? { notes: item.notes } : {}),
    // v4: pass L2 status through so flag detectors can filter active items.
    ...(item.status != null ? { status: item.status } : {}),
    ...(item.startDate != null ? { startDate: item.startDate } : {}),
    ...(item.endDate != null ? { endDate: item.endDate } : {}),
    ...(updatedMs != null ? { updatedAtMs: updatedMs } : {}),
    ...(blockedByRefs.length > 0 ? { blockedBy: blockedByRefs } : {}),
  };
}

// Default key = startDate-first so Today / This Week / Upcoming / In Flight
// surface range tasks under their kickoff day. Callers focused on past-due
// work (e.g. getStaleWeekItems → Needs Update) override with endDate-first
// so day-group labels reflect "when did this go red."
function groupWeekItemsIntoDays(
  items: WeekItemRow[],
  clientNameById: Map<string, string>,
  keyFn: (item: WeekItemRow) => string = (item) => item.startDate ?? item.date ?? "",
): WeekDay[] {
  const grouped = groupBy(items, keyFn);
  const sortedDates = [...grouped.keys()].sort();
  // Build an id→item map so resolveBlockedByRefs can decorate each entry
  // with blocker title/status without extra queries (O(1) lookups).
  const weekItemById = new Map<string, WeekItemRow>();
  for (const item of items) weekItemById.set(item.id, item);
  return sortedDates.map((dateStr) => ({
    date: dateStr,
    label: formatDayLabel(dateStr),
    items: (grouped.get(dateStr) ?? []).map((item) =>
      mapWeekItemToEntry(item, clientNameById, weekItemById)
    ),
  }));
}

// ── Queries ─────────────────────────────────────────────

export async function getClientsWithProjects(): Promise<ClientWithProjects[]> {
  const db = getRunwayDb();

  const allClients = await db
    .select()
    .from(clients)
    .orderBy(asc(clients.name));

  const allProjects = await db
    .select()
    .from(projects)
    .orderBy(asc(projects.sortOrder));

  // Group projects by clientId using Map for O(1) lookups
  const projectsByClient = groupBy(allProjects, (p) => p.clientId);

  return allClients.map((client) => ({
    ...client,
    items: projectsByClient.get(client.id) ?? [],
  }));
}

// weekOf is indexed (idx_week_items_week_of) — see runway-schema.ts
export async function getWeekItems(weekOf?: string): Promise<WeekDay[]> {
  const db = getRunwayDb();

  const clientNameById = await getClientNameMap();

  const items = weekOf
    ? await db
        .select()
        .from(weekItems)
        .where(eq(weekItems.weekOf, weekOf))
        .orderBy(asc(weekItems.date), asc(weekItems.sortOrder))
    : await db
        .select()
        .from(weekItems)
        .orderBy(asc(weekItems.date), asc(weekItems.sortOrder));

  return groupWeekItemsIntoDays(items, clientNameById);
}

export async function getPipeline(): Promise<PipelineRow[]> {
  const db = getRunwayDb();

  const clientNameById = await getClientNameMap();

  const items = await db
    .select()
    .from(pipelineItems)
    .orderBy(asc(pipelineItems.sortOrder));

  return items.map((item) => ({
    ...item,
    accountName: item.clientId ? (clientNameById.get(item.clientId) ?? null) : null,
  }));
}

/**
 * Get past-due week items: `endDate ?? date < today` AND status != 'completed'.
 *
 * Fetched over a 180-day weekOf lookback so range tasks whose `weekOf` is
 * older than the past-due window but whose `endDate` just passed still
 * surface. Result is grouped by `endDate ?? date` (the due day) so the
 * Needs Update day-group labels read "when did this go red."
 *
 * Per Data TP convention: Needs Update is the "red" state — the only way
 * out is staff action on the L2 (mark `completed` OR push `endDate` forward).
 * No suppression based on parent-project edits or update freshness.
 */
export async function getStaleWeekItems(): Promise<WeekDay[]> {
  const db = getRunwayDb();
  const now = new Date();
  const todayISO = toISODateString(now);
  const mondayISO = getMondayISODate(now);

  // Look back 180 days (~6 months) to catch range tasks whose weekOf is
  // older than the past-due window but whose endDate just passed. The
  // weekOf-based fetch is indexed; the JS-level past-due predicate (below)
  // remains the source of truth, and the SQL OR clause mirrors it exactly so
  // we don't haul back the entire 180-day window for the JS pass to discard.
  const lookbackMonday = new Date(getMonday(now));
  lookbackMonday.setDate(lookbackMonday.getDate() - 180);
  const lookbackISO = toISODateString(lookbackMonday);

  const clientNameById = await getClientNameMap();

  // Fetch only past-due rows in the 180-day weekOf window. The OR clause
  // mirrors `endDate ?? date < today` row-by-row:
  //   - endDate present and < today, OR
  //   - endDate null and date < today
  // Verbose form (rather than `lt(coalesce(endDate, date), today)`) matches
  // the JS predicate exactly and is drift-resistant against rows where
  // date != endDate (the convention isn't yet guaranteed across all clients).
  const allItems = await db
    .select()
    .from(weekItems)
    .where(
      and(
        gte(weekItems.weekOf, lookbackISO),
        lte(weekItems.weekOf, mondayISO),
        or(
          and(isNotNull(weekItems.endDate), lt(weekItems.endDate, todayISO)),
          and(isNull(weekItems.endDate), lt(weekItems.date, todayISO)),
        ),
      ),
    )
    .orderBy(asc(weekItems.date), asc(weekItems.sortOrder));

  // Past-due predicate: endDate ?? date < today AND not completed.
  // Per Data TP convention: date == endDate for range tasks, but be defensive
  // with the ?? fallback in case any row drifts.
  const pastItems = allItems.filter((item) => {
    const dueDate = item.endDate ?? item.date;
    return dueDate != null && dueDate < todayISO && item.status !== "completed";
  });
  if (pastItems.length === 0) return [];

  // Needs Update is the "red" state. The only way out is staff action on the
  // L2 itself — mark `completed` OR push `endDate` forward. No suppression
  // based on parent-project edits, sibling-row edits, or freshness windows.
  // (The previous freshness-window suppression was hiding real overdue work.)
  //
  // Bucket on endDate (due day) so day-group labels read "when did this go
  // red" — overrides the default startDate-first keying used elsewhere.
  return groupWeekItemsIntoDays(
    pastItems,
    clientNameById,
    (item) => item.endDate ?? item.date ?? "",
  );
}
