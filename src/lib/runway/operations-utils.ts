/**
 * Runway Operations — shared utility functions and queries
 *
 * Helpers used across all operations-*.ts modules.
 * Do NOT import from "./operations" here — that would create a circular dependency.
 * Instead, other operations-*.ts files import these via the barrel in operations.ts.
 */

import { getRunwayDb } from "@/lib/db/runway";
import {
  clients,
  projects,
  updates,
  weekItems,
} from "@/lib/db/runway-schema";
import { eq, asc } from "drizzle-orm";
import { createHash } from "crypto";

// ── Constants ────────────────────────────────────────────

/**
 * Statuses that cascade from a project to its linked week items.
 * Terminal or blocking states propagate down; non-terminal statuses don't
 * because individual week items may be at different stages.
 */
export const CASCADE_STATUSES = ["completed", "blocked", "on-hold"] as const;

/**
 * Week item statuses that should not be overwritten by cascade.
 * Items already in a terminal state are left alone.
 */
export const TERMINAL_ITEM_STATUSES = ["completed", "canceled"] as const;

// ── Utilities ─────────────────────────────────────────────

/**
 * Generate a deterministic idempotency key from parts.
 * SHA-256 hash, truncated to 40 hex chars.
 */
export function generateIdempotencyKey(...parts: string[]): string {
  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 40);
}

/**
 * Generate a short unique ID (25 hex chars from a UUID).
 */
export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 25);
}

/**
 * Standard "client not found" error result.
 * Used by operations-writes.ts and operations-add.ts.
 */
export function clientNotFoundError(clientSlug: string) {
  return { ok: false as const, error: `Client '${clientSlug}' not found.` };
}

/**
 * Look up a client by slug, returning the row or a standard error result.
 * Replaces the repeated `getClientBySlug(slug) + if (!client) return clientNotFoundError(slug)` pattern.
 */
export async function getClientOrFail(
  clientSlug: string
): Promise<
  | { ok: true; client: ClientRow }
  | { ok: false; error: string }
> {
  const client = await getClientBySlug(clientSlug);
  if (!client) return clientNotFoundError(clientSlug);
  return { ok: true, client };
}

/**
 * Case-insensitive substring match.
 * Returns true if `value` contains `search` (ignoring case).
 */
export function matchesSubstring(
  value: string | null | undefined,
  search: string
): boolean {
  if (!value) return false;
  return value.toLowerCase().includes(search.toLowerCase());
}

/**
 * Group an array of items by a key function.
 * Returns a Map of key -> items[].
 */
export function groupBy<T, K>(
  items: T[],
  keyFn: (item: T) => K
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

// ── Request-scoped client cache ──────────────────────────
// Avoids repeated DB round-trips for clients within a single
// MCP tool call or bot tool call. Expires after 5 seconds
// so concurrent requests don't serve stale data.

type ClientRow = typeof clients.$inferSelect;

let _cachedClients: ClientRow[] | null = null;
let _cacheTimestamp = 0;
const CLIENT_CACHE_TTL_MS = 5_000;

async function getCachedClients(): Promise<ClientRow[]> {
  const now = Date.now();
  if (_cachedClients && now - _cacheTimestamp < CLIENT_CACHE_TTL_MS) {
    return _cachedClients;
  }
  const db = getRunwayDb();
  _cachedClients = await db.select().from(clients).orderBy(asc(clients.name));
  _cacheTimestamp = now;
  return _cachedClients;
}

// ── Shared Queries ────────────────────────────────────────

export async function getAllClients() {
  return getCachedClients();
}

export async function getClientBySlug(
  slug: string
): Promise<ClientRow | null> {
  const allClients = await getCachedClients();
  return allClients.find((c) => c.slug === slug) ?? null;
}

export async function getClientNameMap(): Promise<Map<string, string>> {
  const allClients = await getCachedClients();
  return new Map(allClients.map((c) => [c.id, c.name]));
}

export type FuzzyMatchResult<T> =
  | { kind: "match"; value: T }
  | { kind: "ambiguous"; options: T[] }
  | { kind: "none" };

/**
 * Generic ranked fuzzy match:
 * 1. Exact match (case-insensitive) — single result, highest confidence
 * 2. Starts-with match — single if only one, else ambiguous
 * 3. Substring match — single if only one, else ambiguous
 *
 * @param getText - extractor for the searchable text field (e.g. `p => p.name`)
 */

/** Normalize dashes and whitespace for fuzzy comparison */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[\u2014\u2013\-]+/g, " ")  // em dash, en dash, hyphen → space
    .replace(/\s+/g, " ")                 // collapse whitespace
    .trim()
    .toLowerCase();
}

export function fuzzyMatch<T>(
  items: T[],
  searchTerm: string,
  getText: (item: T) => string
): FuzzyMatchResult<T> {
  const search = normalizeForMatch(searchTerm);
  // Pre-normalize all items once to avoid repeated normalization per stage
  const normalized = items.map((item) => ({
    item,
    text: normalizeForMatch(getText(item)),
  }));

  const exact = normalized.find((n) => n.text === search);
  if (exact) return { kind: "match", value: exact.item };

  const startsWith = normalized.filter((n) => n.text.startsWith(search));
  if (startsWith.length === 1) return { kind: "match", value: startsWith[0].item };
  if (startsWith.length > 1) return { kind: "ambiguous", options: startsWith.map((n) => n.item) };

  const substring = normalized.filter((n) => n.text.includes(search));
  if (substring.length === 1) return { kind: "match", value: substring[0].item };
  if (substring.length > 1) return { kind: "ambiguous", options: substring.map((n) => n.item) };

  return { kind: "none" };
}

/** Convenience wrapper — fuzzy match on `.name` field */
export function fuzzyMatchProject<T extends { name: string }>(
  items: T[],
  searchTerm: string
): FuzzyMatchResult<T> {
  return fuzzyMatch(items, searchTerm, (p) => p.name);
}

export async function findProjectByFuzzyName(
  clientId: string,
  projectName: string
): Promise<typeof projects.$inferSelect | null> {
  const db = getRunwayDb();
  const clientProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.clientId, clientId));

  const result = fuzzyMatchProject(clientProjects, projectName);
  if (result.kind === "match") return result.value;
  return null;
}

/**
 * Like findProjectByFuzzyName but returns disambiguation info.
 * Callers can use the ambiguous result to ask the user which project.
 */
export async function findProjectByFuzzyNameWithDisambiguation(
  clientId: string,
  projectName: string
): Promise<FuzzyMatchResult<typeof projects.$inferSelect>> {
  const db = getRunwayDb();
  const clientProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.clientId, clientId));

  return fuzzyMatchProject(clientProjects, projectName);
}

/**
 * Resolve a project by fuzzy name with full disambiguation error handling.
 * Eliminates the repeated ambiguous/none pattern in write operations.
 */
export async function resolveProjectOrFail(
  clientId: string,
  clientName: string,
  projectName: string
): Promise<
  | { ok: true; project: typeof projects.$inferSelect }
  | { ok: false; error: string; available?: string[] }
> {
  const fuzzyResult = await findProjectByFuzzyNameWithDisambiguation(clientId, projectName);
  if (fuzzyResult.kind === "ambiguous") {
    return {
      ok: false,
      error: `Multiple projects match '${projectName}': ${fuzzyResult.options.map((p) => p.name).join(", ")}. Which one?`,
      available: fuzzyResult.options.map((p) => p.name),
    };
  }
  if (fuzzyResult.kind === "none") {
    const clientProjects = await getProjectsForClient(clientId);
    return {
      ok: false,
      error: `Project '${projectName}' not found for ${clientName}.`,
      available: clientProjects.map((p) => p.name),
    };
  }
  return { ok: true, project: fuzzyResult.value };
}

export async function getProjectsForClient(clientId: string) {
  const db = getRunwayDb();
  return db
    .select()
    .from(projects)
    .where(eq(projects.clientId, clientId))
    .orderBy(asc(projects.sortOrder));
}

export async function checkIdempotency(idemKey: string): Promise<boolean> {
  const db = getRunwayDb();
  const existing = await db
    .select()
    .from(updates)
    .where(eq(updates.idempotencyKey, idemKey));
  return existing.length > 0;
}

// ── Field Constants ──────────────────────────────────────

/** Editable fields on a project (excludes status — that uses updateProjectStatus). */
export const PROJECT_FIELDS = [
  "name", "dueDate", "owner", "resources", "waitingOn", "target", "notes",
] as const;

export type ProjectField = (typeof PROJECT_FIELDS)[number];

export const PROJECT_FIELD_TO_COLUMN: Record<ProjectField, keyof typeof projects.$inferSelect> = {
  name: "name",
  dueDate: "dueDate",
  owner: "owner",
  resources: "resources",
  waitingOn: "waitingOn",
  target: "target",
  notes: "notes",
};

/** Editable fields on a week item. */
export const WEEK_ITEM_FIELDS = [
  "title", "status", "date", "dayOfWeek", "owner", "resources", "notes", "category",
] as const;

export type WeekItemField = (typeof WEEK_ITEM_FIELDS)[number];

export const WEEK_ITEM_FIELD_TO_COLUMN: Record<WeekItemField, keyof typeof weekItems.$inferSelect> = {
  title: "title",
  status: "status",
  date: "date",
  dayOfWeek: "dayOfWeek",
  owner: "owner",
  resources: "resources",
  notes: "notes",
  category: "category",
};

/**
 * Fields that undo can revert — union of project fields + status + category.
 * Derived from PROJECT_FIELDS so additions to the project schema automatically
 * become undoable without maintaining a separate list.
 */
export const UNDO_FIELDS = [
  ...PROJECT_FIELDS, "status", "category",
] as const;

// ── Field Validation ─────────────────────────────────────

/**
 * Validate a field name against an allowed list.
 * Returns an error OperationResult if invalid, null if valid.
 */
export function validateField(
  field: string,
  allowedFields: readonly string[]
): { ok: false; error: string } | null {
  if (!allowedFields.includes(field)) {
    return {
      ok: false,
      error: `Invalid field '${field}'. Allowed fields: ${allowedFields.join(", ")}`,
    };
  }
  return null;
}

// ── Audit & Idempotency Helpers ─────────────────────────

type OperationResult =
  | { ok: true; message: string; data?: Record<string, unknown> }
  | { ok: false; error: string; available?: string[] };

export interface AuditRecordParams {
  idempotencyKey: string;
  projectId?: string | null;
  clientId?: string | null;
  updatedBy: string;
  updateType: string;
  previousValue?: string | null;
  newValue?: string | null;
  summary: string;
  metadata?: string;
}

/** Insert an audit record into the updates table. */
export async function insertAuditRecord(params: AuditRecordParams): Promise<void> {
  const db = getRunwayDb();
  await db.insert(updates).values({
    id: generateId(),
    idempotencyKey: params.idempotencyKey,
    projectId: params.projectId ?? null,
    clientId: params.clientId ?? null,
    updatedBy: params.updatedBy,
    updateType: params.updateType,
    previousValue: params.previousValue ?? null,
    newValue: params.newValue ?? null,
    summary: params.summary,
    metadata: params.metadata,
  });
}

/**
 * Check idempotency and return a duplicate result if already applied.
 * Returns the duplicate OperationResult if the key exists, null otherwise.
 */
export async function checkDuplicate(
  idemKey: string,
  duplicateResult: OperationResult
): Promise<OperationResult | null> {
  if (await checkIdempotency(idemKey)) return duplicateResult;
  return null;
}

// ── Week Item Queries ────────────────────────────────────

/** Convenience wrapper — fuzzy match on `.title` field */
export function fuzzyMatchWeekItem<T extends { title: string }>(
  items: T[],
  searchTerm: string
): FuzzyMatchResult<T> {
  return fuzzyMatch(items, searchTerm, (i) => i.title);
}

export async function findWeekItemByFuzzyTitle(
  weekOf: string,
  title: string
): Promise<typeof weekItems.$inferSelect | null> {
  const db = getRunwayDb();
  const items = await db
    .select()
    .from(weekItems)
    .where(eq(weekItems.weekOf, weekOf));

  const result = fuzzyMatchWeekItem(items, title);
  if (result.kind === "match") return result.value;
  return null;
}

export async function findWeekItemByFuzzyTitleWithDisambiguation(
  weekOf: string,
  title: string
): Promise<FuzzyMatchResult<typeof weekItems.$inferSelect>> {
  const db = getRunwayDb();
  const items = await db
    .select()
    .from(weekItems)
    .where(eq(weekItems.weekOf, weekOf));

  return fuzzyMatchWeekItem(items, title);
}

export async function getWeekItemsForWeek(weekOf: string) {
  const db = getRunwayDb();
  return db
    .select()
    .from(weekItems)
    .where(eq(weekItems.weekOf, weekOf))
    .orderBy(asc(weekItems.sortOrder));
}

/**
 * Resolve a week item by fuzzy title with full disambiguation error handling.
 * Mirrors resolveProjectOrFail for week items.
 */
export async function resolveWeekItemOrFail(
  weekOf: string,
  weekItemTitle: string
): Promise<
  | { ok: true; item: typeof weekItems.$inferSelect }
  | { ok: false; error: string; available?: string[] }
> {
  const fuzzyResult = await findWeekItemByFuzzyTitleWithDisambiguation(weekOf, weekItemTitle);
  if (fuzzyResult.kind === "ambiguous") {
    return {
      ok: false,
      error: `Multiple week items match '${weekItemTitle}': ${fuzzyResult.options.map((i) => i.title).join(", ")}. Which one?`,
      available: fuzzyResult.options.map((i) => i.title),
    };
  }
  if (fuzzyResult.kind === "none") {
    const weekItemsList = await getWeekItemsForWeek(weekOf);
    return {
      ok: false,
      error: `Week item '${weekItemTitle}' not found for week of ${weekOf}.`,
      available: weekItemsList.map((i) => i.title),
    };
  }
  return { ok: true, item: fuzzyResult.value };
}
