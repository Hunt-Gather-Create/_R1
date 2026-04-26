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
  pipelineItems,
  teamMembers,
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

/**
 * Invalidate the in-memory client cache.
 * Called after creating a new client so subsequent lookups find it.
 * Also used in tests to reset state between runs.
 */
export function invalidateClientCache(): void {
  _cachedClients = null;
  _cacheTimestamp = 0;
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

/** Look up a single client name by ID. Returns undefined if not found. */
export async function getClientNameById(clientId: string | null): Promise<string | undefined> {
  if (!clientId) return undefined;
  const allClients = await getCachedClients();
  return allClients.find((c) => c.id === clientId)?.name;
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
  const result = await findProjectByFuzzyNameWithDisambiguation(clientId, projectName);
  return result.kind === "match" ? result.value : null;
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
 * Generic fuzzy-resolve with disambiguation error handling.
 * Eliminates the repeated ambiguous/none/match pattern in all resolve*OrFail functions.
 */
export function resolveEntityOrFail<T>(opts: {
  items: T[];
  searchTerm: string;
  getText: (item: T) => string;
  entityLabel: string;
  contextLabel?: string;
}): { ok: true; item: T } | { ok: false; error: string; available?: string[] } {
  const result = fuzzyMatch(opts.items, opts.searchTerm, opts.getText);
  if (result.kind === "ambiguous") {
    return {
      ok: false,
      error: `Multiple ${opts.entityLabel}s match '${opts.searchTerm}': ${result.options.map(opts.getText).join(", ")}. Which one?`,
      available: result.options.map(opts.getText),
    };
  }
  if (result.kind === "none") {
    const label = opts.entityLabel.charAt(0).toUpperCase() + opts.entityLabel.slice(1);
    return {
      ok: false,
      error: `${label} '${opts.searchTerm}' not found${opts.contextLabel ? ` ${opts.contextLabel}` : ""}.`,
      available: opts.items.map(opts.getText),
    };
  }
  return { ok: true, item: result.value };
}

/**
 * Resolve a project by fuzzy name with full disambiguation error handling.
 */
export async function resolveProjectOrFail(
  clientId: string,
  clientName: string,
  projectName: string
): Promise<
  | { ok: true; project: typeof projects.$inferSelect }
  | { ok: false; error: string; available?: string[] }
> {
  const db = getRunwayDb();
  const items = await db.select().from(projects).where(eq(projects.clientId, clientId));
  const result = resolveEntityOrFail({
    items,
    searchTerm: projectName,
    getText: (p) => p.name,
    entityLabel: "project",
    contextLabel: `for ${clientName}`,
  });
  if (!result.ok) return result;
  return { ok: true, project: result.item };
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
  "name", "dueDate", "owner", "resources", "waitingOn", "notes", "category",
  // v4 convention (2026-04-21): retainer + contract metadata writable via
  // updateProjectField. `startDate` / `endDate` remain derived from children
  // and are recomputed by `recomputeProjectDates`, not set directly here.
  "engagementType", "contractStart", "contractEnd",
  // v4 convention (2026-04-21 / PR #88 Chunk F): retainer wrapper parent
  // link. Null/empty-string clears, any string sets. No FK enforcement.
  "parentProjectId",
] as const;

export type ProjectField = (typeof PROJECT_FIELDS)[number];

export const PROJECT_FIELD_TO_COLUMN: Record<ProjectField, keyof typeof projects.$inferSelect> = {
  name: "name",
  dueDate: "dueDate",
  owner: "owner",
  resources: "resources",
  waitingOn: "waitingOn",
  notes: "notes",
  category: "category",
  engagementType: "engagementType",
  contractStart: "contractStart",
  contractEnd: "contractEnd",
  parentProjectId: "parentProjectId",
};

/**
 * Editable fields on a week item.
 *
 * `weekOf` is here as a plain whitelist entry for now — callers updating it
 * are responsible for keeping it consistent with `date` (Monday of the same
 * week). Longer-term answer is a dedicated `updateWeekItemWeekBucket` helper
 * that derives weekOf from date and validates the invariant.
 */
export const WEEK_ITEM_FIELDS = [
  "title", "status", "date", "dayOfWeek", "weekOf", "owner", "resources", "notes", "category",
  // v4 convention (2026-04-21): explicit start/end dates + dependency list.
  "startDate", "endDate", "blockedBy",
] as const;

export type WeekItemField = (typeof WEEK_ITEM_FIELDS)[number];

export const WEEK_ITEM_FIELD_TO_COLUMN: Record<WeekItemField, keyof typeof weekItems.$inferSelect> = {
  title: "title",
  status: "status",
  date: "date",
  dayOfWeek: "dayOfWeek",
  weekOf: "weekOf",
  owner: "owner",
  resources: "resources",
  notes: "notes",
  category: "category",
  startDate: "startDate",
  endDate: "endDate",
  blockedBy: "blockedBy",
};

/**
 * Fields that undo can revert — union of project fields + status.
 * Derived from PROJECT_FIELDS so additions to the project schema automatically
 * become undoable without maintaining a separate list. (`category` is now part
 * of PROJECT_FIELDS so it's included via the spread.)
 */
export const UNDO_FIELDS = [
  ...PROJECT_FIELDS, "status",
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

/**
 * Validate a field name and resolve it to a typed field + column key.
 * Combines the repeated validateField + typecast + column lookup pattern.
 * Returns an error OperationResult if invalid, or the resolved field + column.
 */
export function validateAndResolveField<F extends string>(
  field: string,
  allowedFields: readonly F[],
  fieldToColumn: Record<F, string>
): { ok: false; error: string } | { ok: true; typedField: F; columnKey: string } {
  const error = validateField(field, allowedFields);
  if (error) return error;
  const typedField = field as F;
  return { ok: true, typedField, columnKey: fieldToColumn[typedField] };
}

// ── Audit & Idempotency Helpers ─────────────────────────

export type OperationResult =
  | { ok: true; message: string; data?: Record<string, unknown> }
  | { ok: false; error: string; available?: string[] };

// ── Batch Mode ────────────────────────────────────────────

let _currentBatchId: string | null = null;

/** Set the current batch ID. All subsequent audit records will be tagged with this ID. */
export function setBatchId(id: string | null): void { _currentBatchId = id; }

/** Get the current batch ID (null if not in batch mode). */
export function getBatchId(): string | null { return _currentBatchId; }

export interface AuditRecordParams {
  /** Optional: pre-generated id. Useful when the caller needs to link child records
   *  via `triggeredByUpdateId` before insertion completes. Defaults to a fresh id. */
  id?: string;
  idempotencyKey: string;
  projectId?: string | null;
  clientId?: string | null;
  updatedBy: string;
  updateType: string;
  previousValue?: string | null;
  newValue?: string | null;
  summary: string;
  metadata?: string;
  batchId?: string | null;
  /** v4: id of the parent update that triggered this cascade-generated record. */
  triggeredByUpdateId?: string | null;
}

/** Insert an audit record into the updates table. Returns the inserted row's id. */
export async function insertAuditRecord(params: AuditRecordParams): Promise<string> {
  const db = getRunwayDb();
  const id = params.id ?? generateId();
  await db.insert(updates).values({
    id,
    idempotencyKey: params.idempotencyKey,
    projectId: params.projectId ?? null,
    clientId: params.clientId ?? null,
    updatedBy: params.updatedBy,
    updateType: params.updateType,
    previousValue: params.previousValue ?? null,
    newValue: params.newValue ?? null,
    summary: params.summary,
    metadata: params.metadata,
    batchId: params.batchId ?? _currentBatchId ?? null,
    triggeredByUpdateId: params.triggeredByUpdateId ?? null,
  });
  return id;
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
  const result = await findWeekItemByFuzzyTitleWithDisambiguation(weekOf, title);
  return result.kind === "match" ? result.value : null;
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
 */
export async function resolveWeekItemOrFail(
  weekOf: string,
  weekItemTitle: string
): Promise<
  | { ok: true; item: typeof weekItems.$inferSelect }
  | { ok: false; error: string; available?: string[] }
> {
  const db = getRunwayDb();
  const items = await db.select().from(weekItems).where(eq(weekItems.weekOf, weekOf));
  return resolveEntityOrFail({
    items,
    searchTerm: weekItemTitle,
    getText: (i) => i.title,
    entityLabel: "week item",
    contextLabel: `for week of ${weekOf}`,
  });
}

// ── Pipeline Item Fields & Queries ─────────────────────

export const PIPELINE_ITEM_FIELDS = [
  "name", "owner", "status", "estimatedValue", "waitingOn", "notes",
] as const;

export type PipelineItemField = (typeof PIPELINE_ITEM_FIELDS)[number];

export const PIPELINE_ITEM_FIELD_TO_COLUMN: Record<PipelineItemField, keyof typeof pipelineItems.$inferSelect> = {
  name: "name",
  owner: "owner",
  status: "status",
  estimatedValue: "estimatedValue",
  waitingOn: "waitingOn",
  notes: "notes",
};

export async function findPipelineItemByFuzzyName(
  clientId: string,
  name: string
): Promise<typeof pipelineItems.$inferSelect | null> {
  const db = getRunwayDb();
  const items = await db
    .select()
    .from(pipelineItems)
    .where(eq(pipelineItems.clientId, clientId));
  const result = fuzzyMatch(items, name, (i) => i.name);
  if (result.kind === "match") return result.value;
  return null;
}

export async function resolvePipelineItemOrFail(
  clientId: string,
  clientName: string,
  pipelineName: string
): Promise<
  | { ok: true; item: typeof pipelineItems.$inferSelect }
  | { ok: false; error: string; available?: string[] }
> {
  const db = getRunwayDb();
  const items = await db
    .select()
    .from(pipelineItems)
    .where(eq(pipelineItems.clientId, clientId));
  return resolveEntityOrFail({
    items,
    searchTerm: pipelineName,
    getText: (i) => i.name,
    entityLabel: "pipeline item",
    contextLabel: `for ${clientName}`,
  });
}

// ── Client Fields ──────────────────────────────────────

export const CLIENT_FIELDS = [
  "name", "team", "contractValue", "contractTerm", "contractStatus", "clientContacts", "nicknames",
] as const;

export type ClientField = (typeof CLIENT_FIELDS)[number];

export const CLIENT_FIELD_TO_COLUMN: Record<ClientField, keyof typeof clients.$inferSelect> = {
  name: "name",
  team: "team",
  contractValue: "contractValue",
  contractTerm: "contractTerm",
  contractStatus: "contractStatus",
  clientContacts: "clientContacts",
  nicknames: "nicknames",
};

// ── Team Member Fields & Queries ───────────────────────

export const TEAM_MEMBER_FIELDS = [
  "title", "fullName", "slackUserId", "roleCategory", "accountsLed", "isActive", "nicknames", "channelPurpose",
] as const;

export type TeamMemberField = (typeof TEAM_MEMBER_FIELDS)[number];

export const TEAM_MEMBER_FIELD_TO_COLUMN: Record<TeamMemberField, keyof typeof teamMembers.$inferSelect> = {
  title: "title",
  fullName: "fullName",
  slackUserId: "slackUserId",
  roleCategory: "roleCategory",
  accountsLed: "accountsLed",
  isActive: "isActive",
  nicknames: "nicknames",
  channelPurpose: "channelPurpose",
};

export async function findTeamMemberByFuzzyName(
  name: string
): Promise<typeof teamMembers.$inferSelect | null> {
  const db = getRunwayDb();
  const members = await db.select().from(teamMembers);
  const result = fuzzyMatch(members, name, (m) => m.name);
  if (result.kind === "match") return result.value;
  return null;
}

export async function resolveTeamMemberOrFail(
  memberName: string
): Promise<
  | { ok: true; member: typeof teamMembers.$inferSelect }
  | { ok: false; error: string; available?: string[] }
> {
  const db = getRunwayDb();
  const members = await db.select().from(teamMembers);
  const result = resolveEntityOrFail({
    items: members,
    searchTerm: memberName,
    getText: (m) => m.name,
    entityLabel: "team member",
  });
  if (!result.ok) return result;
  return { ok: true, member: result.item };
}

// ── Entity Field Helpers ──────────────────────────────

/**
 * Extract the previous value of a field from an entity row.
 * Coerces to string, defaulting null/undefined to empty string.
 */
export function getPreviousValue(
  entity: Record<string, unknown>,
  columnKey: string
): string {
  return String(entity[columnKey] ?? "");
}

// ── Resource & Name Helpers ────────────────────────────

/**
 * Case-insensitive check if a string contains a name.
 */
export function containsName(value: string | null, name: string): boolean {
  if (!value) return false;
  return value.toLowerCase().includes(name.toLowerCase());
}

/**
 * Replace a name in a comma- or slash-separated resource string.
 * Splits by separator, replaces matching names, deduplicates, rejoins.
 */
export function replaceResourceName(
  current: string,
  search: string,
  replacement: string
): string {
  const sep = current.includes("/") ? "/" : ",";
  const parts = current.split(sep).map((s) => s.trim());
  const replaced = parts.map((p) =>
    p.toLowerCase() === search.toLowerCase() ? replacement : p
  );
  const deduped = [...new Set(replaced)];
  return deduped.join(sep === "/" ? "/" : ", ");
}

/**
 * Remove a name from a comma- or slash-separated resource string.
 * Returns null when the sole resource is removed.
 */
export function removeFromResources(
  resources: string | null,
  name: string
): string | null {
  if (!resources) return null;
  const sep = resources.includes("/") ? "/" : ",";
  const parts = resources
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s.toLowerCase() !== name.toLowerCase());
  if (parts.length === 0) return null;
  return parts.join(sep === "/" ? "/" : ", ");
}

/**
 * Merge new entries into a JSON array string, deduplicating.
 * Used for accountsLed and similar JSON array fields.
 */
export function mergeJsonArray(
  current: string | null,
  toAdd: string[]
): string {
  const existing: string[] = current ? JSON.parse(current) : [];
  const merged = [...new Set([...existing, ...toAdd])];
  return JSON.stringify(merged);
}

// ── v4 Resources Parser ─────────────────────────────────

/**
 * A single parsed entry from a resources string.
 *
 * @see docs/tmp/runway-v4-convention.md §"Resources field format"
 */
export type ResourceEntry = {
  /** Role abbreviation: AM, CD, Dev, CW, PM, CM, Strat. Empty string when no prefix was given. */
  role: string;
  /** Person name (trimmed). For client-led work this may be the client name. */
  person: string;
  /**
   * 0 for first position in an arrow chain, 1 for second, etc.
   * Comma-joined entries at the same arrow position share the same number.
   */
  handoffPosition: number;
  /** True when this entry is comma-joined at its handoff position (peer collaboration). */
  isConcurrent: boolean;
};

/** Matches unicode/alternative arrow forms accepted by the parser. Canonical arrow is `->`. */
const ARROW_NORMALIZE_RE = /\s*(?:->|→|=>|>>)\s*/g;

/**
 * Normalize a resources string to canonical form:
 * - Converts `→`, `=>`, `>>` to `->`
 * - Trims and collapses whitespace around `->` and `,`
 * - Preserves order; does not dedupe or validate entries
 *
 * Used on write (Chunk 5) to persist resources in a consistent format.
 * Wired into: `createWeekItem`, `updateWeekItemField` (field === "resources"),
 * `addProject`, `updateProjectField` (field === "resources"),
 * `createClient` (team field), `updateClientField` (field === "team").
 * Read paths consume storage as-is.
 */
export function normalizeResourcesString(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(ARROW_NORMALIZE_RE, " -> ")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(", ");
}

/**
 * Parse a resources string into typed entries.
 *
 * Format rules (v4):
 * - `,` separates concurrent collaborators at the same handoff position
 * - `->` (or `→` / `=>` / `>>`) separates sequential handoff positions
 * - Each entry is `Role: Person` or bare `Person` (no role prefix)
 *
 * Examples:
 *   "CD: Lane"                           → [{role:"CD", person:"Lane", handoffPosition:0, isConcurrent:false}]
 *   "CD: Lane, Dev: Leslie"              → both at position 0, isConcurrent=true
 *   "CD: Lane -> Dev: Leslie"            → Lane at 0, Leslie at 1, both isConcurrent=false
 *   "CD: Lane -> Dev: Leslie, CW: Kathy" → Lane at 0 (solo), Leslie+Kathy at 1 (concurrent)
 *
 * Returns an empty array for null/undefined/empty input or when every segment
 * is malformed (empty). Individual malformed entries are skipped silently.
 */
export function parseResources(raw: string | null | undefined): ResourceEntry[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Normalize all arrow forms to a single canonical token for splitting.
  const withCanonicalArrows = trimmed.replace(ARROW_NORMALIZE_RE, "->");
  const stages = withCanonicalArrows.split("->");

  const entries: ResourceEntry[] = [];
  for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
    const stage = stages[stageIdx];
    const peers = stage.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    const isConcurrent = peers.length > 1;
    for (const peer of peers) {
      const colonIdx = peer.indexOf(":");
      let role = "";
      let person = peer;
      if (colonIdx > -1) {
        role = peer.slice(0, colonIdx).trim();
        person = peer.slice(colonIdx + 1).trim();
      }
      if (!person) continue; // skip malformed `Role:` with no person
      entries.push({
        role,
        person,
        handoffPosition: stageIdx,
        isConcurrent,
      });
    }
  }

  return entries;
}

// ── Shared value validators (tool boundary + helper boundary) ────────────
//
// These four validators live here, not in the MCP tool wrapper, so every
// write path runs the same checks. The MCP wrapper validates at the tool
// boundary (defense-in-depth + clearer "got X" error before dispatch); the
// helper revalidates so direct-helper callers (including batch_apply, which
// bypasses the tool boundary) cannot land bad values. One source of truth
// per concern — engagement type, ISO date shape, week item status enum,
// week item category enum. Same idiom as
// `validateParentProjectIdAssignment` below.

/**
 * Allowed values for `projects.engagement_type`. `""` is a sentinel for
 * "clear" (becomes null at the persistence layer). Any other value rejects.
 */
export const ENGAGEMENT_TYPES = ["retainer", "project"] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

export type EngagementTypeValidationResult =
  | { ok: true; value: EngagementType | null }
  | { ok: false; error: string };

/**
 * Validate a string against the engagement-type enum.
 * `""` is accepted and reported as `null` (clear). Valid enum values pass
 * through. Anything else rejects with a stable error string the MCP wrapper
 * and the helper both surface verbatim.
 */
export function validateEngagementType(
  value: string,
): EngagementTypeValidationResult {
  if (value === "") return { ok: true, value: null };
  if (
    !ENGAGEMENT_TYPES.includes(value as EngagementType)
  ) {
    return {
      ok: false,
      error: `engagementType must be one of ${ENGAGEMENT_TYPES.join(", ")} or '' (clear); got '${value}'.`,
    };
  }
  return { ok: true, value: value as EngagementType };
}

export type IsoDateValidationResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Strict ISO-8601 date shape validator (YYYY-MM-DD): regex + real Date
 * parse + roundtrip equality. Rejects shape-valid but date-invalid strings
 * like "2026-13-45". `""` is accepted and reported as `null` (clear).
 *
 * `fieldLabel` is interpolated into the error so the MCP wrapper and the
 * helper produce identical messages — a `batch_apply` op that bypasses the
 * wrapper still surfaces "contractStart must be a valid ISO ..." from the
 * helper.
 */
export function validateIsoDateShape(
  value: string,
  fieldLabel: string,
): IsoDateValidationResult {
  if (value === "") return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return {
      ok: false,
      error: `${fieldLabel} must be a valid ISO YYYY-MM-DD date or '' (clear); got '${value}'.`,
    };
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    return {
      ok: false,
      error: `${fieldLabel} must be a valid ISO YYYY-MM-DD date or '' (clear); got '${value}'.`,
    };
  }
  return { ok: true, value };
}

/**
 * Allowed values for `week_items.status`. `""` clears (becomes null per the
 * v4 convention where NULL = scheduled).
 */
export const WEEK_ITEM_STATUSES = [
  "scheduled",
  "in-progress",
  "blocked",
  "at-risk",
  "completed",
  "canceled",
] as const;
export type WeekItemStatus = (typeof WEEK_ITEM_STATUSES)[number];

export type WeekItemStatusValidationResult =
  | { ok: true; value: WeekItemStatus | null }
  | { ok: false; error: string };

export function validateWeekItemStatus(
  value: string,
): WeekItemStatusValidationResult {
  if (value === "") return { ok: true, value: null };
  if (
    !WEEK_ITEM_STATUSES.includes(value as WeekItemStatus)
  ) {
    return {
      ok: false,
      error: `status must be one of ${WEEK_ITEM_STATUSES.join(", ")} or '' (clear); got '${value}'.`,
    };
  }
  return { ok: true, value: value as WeekItemStatus };
}

/**
 * Allowed values for `week_items.category`. `""` clears (becomes null).
 */
export const WEEK_ITEM_CATEGORIES = [
  "delivery",
  "review",
  "kickoff",
  "deadline",
  "approval",
  "launch",
] as const;
export type WeekItemCategory = (typeof WEEK_ITEM_CATEGORIES)[number];

export type WeekItemCategoryValidationResult =
  | { ok: true; value: WeekItemCategory | null }
  | { ok: false; error: string };

export function validateWeekItemCategory(
  value: string,
): WeekItemCategoryValidationResult {
  if (value === "") return { ok: true, value: null };
  if (
    !WEEK_ITEM_CATEGORIES.includes(value as WeekItemCategory)
  ) {
    return {
      ok: false,
      error: `category must be one of ${WEEK_ITEM_CATEGORIES.join(", ")} or '' (clear); got '${value}'.`,
    };
  }
  return { ok: true, value: value as WeekItemCategory };
}

// ── parentProjectId validators ────────────────────────────

/**
 * Minimal executor shape: just `select`. Compatible with `db` and any `tx`
 * passed into `db.transaction(...)`.
 */
export type ValidatorExecutor = Pick<ReturnType<typeof getRunwayDb>, "select">;

export type ParentProjectIdValidationContext = {
  /** Project being assigned a parent. */
  childId: string;
  /** Child's client_id (no cross-client parenting). */
  childClientId: string;
  /** Resolved new parent id, or null to clear the link. */
  newParentId: string | null;
};

export type ParentProjectIdValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Four invariants enforced for any write that sets parent_project_id:
 *  1. parent must exist (non-null case)
 *  2. parent.engagement_type === "retainer"
 *  3. parent.client_id === child.client_id (no cross-client parenting)
 *  4. no cycle via 10-hop walk (newParentId → parent's parent → ...; reject
 *     if the chain hits childId)
 *
 * Null newParentId (clearing the link) is trivially valid.
 *
 * Both the `set_project_parent` MCP tool and the existing
 * `update_project_field({ field: "parentProjectId" })` write path call this
 * validator. Validators live here, not in handlers, so every write path
 * runs the same four checks (no path can bypass).
 */
export async function validateParentProjectIdAssignment(
  executor: ValidatorExecutor,
  ctx: ParentProjectIdValidationContext,
): Promise<ParentProjectIdValidationResult> {
  if (ctx.newParentId === null) return { ok: true };

  const parentRows = await executor
    .select({
      id: projects.id,
      clientId: projects.clientId,
      engagementType: projects.engagementType,
      parentProjectId: projects.parentProjectId,
    })
    .from(projects)
    .where(eq(projects.id, ctx.newParentId))
    .limit(1);
  const parent = parentRows[0];
  if (!parent) {
    return { ok: false, error: `Parent project '${ctx.newParentId}' not found.` };
  }

  if (parent.engagementType !== "retainer") {
    return {
      ok: false,
      error: `Parent project '${parent.id}' has engagementType='${
        parent.engagementType ?? "null"
      }', must be 'retainer'.`,
    };
  }

  if (parent.clientId !== ctx.childClientId) {
    return {
      ok: false,
      error: `Parent project belongs to client '${parent.clientId}', child belongs to client '${ctx.childClientId}' — cross-client parenting forbidden.`,
    };
  }

  // Cycle check — walk the parent chain up to 10 hops; reject if it ever
  // hits the child being assigned.
  let cursorId: string | null = parent.parentProjectId;
  for (let hop = 0; hop < 10 && cursorId !== null; hop++) {
    if (cursorId === ctx.childId) {
      return {
        ok: false,
        error: `Cycle detected: assigning parent '${ctx.newParentId}' would create a cycle through '${ctx.childId}'.`,
      };
    }
    const nextRows = await executor
      .select({ parentProjectId: projects.parentProjectId })
      .from(projects)
      .where(eq(projects.id, cursorId))
      .limit(1);
    cursorId = nextRows[0]?.parentProjectId ?? null;
  }
  return { ok: true };
}
