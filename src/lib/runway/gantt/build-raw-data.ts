/**
 * Pure RawData assembly for the Runway Gantt pipeline.
 *
 * This is the testable, DB-free export extracted from
 * scripts/lib/gantt/extract-data.ts. The async DB-coupled wrapper
 * (extractData) remains in scripts/lib/gantt/extract-data.ts and imports
 * buildRawData via a relative path back into src/.
 */

import type {
  ClientRow,
  RawData,
  ResolvedSubject,
  WeekItemRow,
} from "./types";

/**
 * Pure: assemble RawData from already-fetched inputs. The same fetched
 * `weekItemsForEntity` is treated as orphans for a wrapper subject and as
 * the rendered child rows for an L1 subject.
 */
export function buildRawData(
  subject: ResolvedSubject,
  client: ClientRow,
  weekItemsForEntity: WeekItemRow[],
): RawData {
  if (subject.kind === "wrapper") {
    return {
      kind: "wrapper",
      entity: subject.project,
      client,
      children: subject.childProjects,
      orphanWeekItems: weekItemsForEntity.map((w) => ({ id: w.id, title: w.title })),
    };
  }
  return {
    kind: "l1",
    entity: subject.project,
    client,
    children: weekItemsForEntity,
  };
}
