/**
 * Runway batch-id context (AsyncLocalStorage).
 *
 * Issue #17: replaces the module-level `let _currentBatchId` accessed via
 * `setBatchId` / `getBatchId`. On Fluid Compute a single Node instance serves
 * many concurrent requests; module-level state bled across requests, tagging
 * audit rows with another request's batch id and silently suppressing Slack
 * updates. AsyncLocalStorage scopes the batch id to its async chain.
 *
 * Usage:
 *   await withBatchId(batchId, async () => { ...do batched ops... });
 *   const id = getCurrentBatchId(); // null outside any withBatchId scope
 */
import { AsyncLocalStorage } from "node:async_hooks";

type BatchStore = { batchId: string };

const als = new AsyncLocalStorage<BatchStore>();

/**
 * Run `fn` with `batchId` available to `getCurrentBatchId()` for the duration
 * of the async chain. Nested calls override the outer id for the inner scope.
 */
export function withBatchId<T>(batchId: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ batchId }, fn);
}

/**
 * Read the batch id active in the current async context. Returns null when
 * called outside any `withBatchId` scope.
 */
export function getCurrentBatchId(): string | null {
  return als.getStore()?.batchId ?? null;
}
