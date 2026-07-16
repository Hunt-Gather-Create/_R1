/**
 * Runway clients-cache request scoping (AsyncLocalStorage).
 *
 * Issue #44: replaces the module-level `let _cachedClients` + timestamp-TTL
 * cache in `operations-utils.ts`. On Fluid Compute a single Node instance
 * serves many concurrent requests; module-level state bled the client list
 * across requests, so a mutation landing during request A's window could
 * leave request B reading stale rows for the remainder of the TTL window.
 *
 * Mirrors the sibling `runway-als.ts` shape used for batch-id scoping.
 *
 * Usage from a request/handler entry point:
 *   return withClientsCache(async () => {
 *     // ... anything that eventually calls getAllClients / getClientBySlug
 *     // now shares one DB-round-trip's worth of client rows within this
 *     // async chain, and cannot see another request's client list.
 *   });
 *
 * Callers outside any `withClientsCache` scope get null from
 * `getRequestClientsCache()` and fall through to a fresh DB fetch every
 * call. That's the correct behavior — cross-request caching was the bug,
 * not the feature.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { clients } from "@/lib/db/runway-schema";

export type ClientRow = typeof clients.$inferSelect;

type Store = { clients: ClientRow[] | null };

const als = new AsyncLocalStorage<Store>();

/**
 * Run `fn` with a fresh per-chain client-cache slot. Every
 * `getAllClients()` / `getClientBySlug()` / `getClientNameMap()` call
 * inside `fn` (and any function it awaits) shares one round-trip to the
 * clients table.
 */
export function withClientsCache<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ clients: null }, fn);
}

/**
 * Read the cached client rows for the current async scope, or null when
 * called outside any `withClientsCache` scope.
 */
export function getRequestClientsCache(): ClientRow[] | null {
  return als.getStore()?.clients ?? null;
}

/**
 * Store the fetched client rows on the current async scope's slot. Safe
 * to call outside a scope: it becomes a no-op.
 */
export function setRequestClientsCache(rows: ClientRow[]): void {
  const store = als.getStore();
  if (store) store.clients = rows;
}

/**
 * Invalidate the cached client rows on the current async scope's slot,
 * forcing the next read to hit the DB. Safe to call outside a scope: it
 * becomes a no-op.
 */
export function invalidateRequestClientsCache(): void {
  const store = als.getStore();
  if (store) store.clients = null;
}
