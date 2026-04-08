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

export async function findProjectByFuzzyName(
  clientId: string,
  projectName: string
): Promise<typeof projects.$inferSelect | null> {
  const db = getRunwayDb();
  const clientProjects = await db
    .select()
    .from(projects)
    .where(eq(projects.clientId, clientId));

  const searchTerm = projectName.toLowerCase();
  return (
    clientProjects.find((p) => p.name.toLowerCase().includes(searchTerm)) ??
    null
  );
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
