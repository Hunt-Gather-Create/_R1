/**
 * Runway Read Operations — barrel re-export
 *
 * All read operations split into focused modules:
 * - operations-reads-clients.ts — client & project queries
 * - operations-reads-week.ts — week items & workload queries
 * - operations-reads-pipeline.ts — pipeline & stale items queries
 *
 * This file re-exports everything so existing imports remain stable.
 */

export { getClientsWithCounts, getProjectsFiltered, getClientDetail } from "./operations-reads-clients";
export type {
  GetClientsWithCountsOptions,
  GetClientDetailOptions,
  ClientDetail,
  ClientDetailProject,
  ClientDetailPipelineItem,
  ClientDetailUpdate,
} from "./operations-reads-clients";
export { getLinkedWeekItems, getLinkedDeadlineItems, getOrphanWeekItems, getWeekItemsData, getWeekItemsInRange, getWeekItemsByProject, getPersonWorkload } from "./operations-reads-week";
export type { WeekItemRow } from "./operations-reads-week";
export { getPipelineData, getStaleItemsForAccounts } from "./operations-reads-pipeline";
export type { StaleAccountItem } from "./operations-reads-pipeline";
