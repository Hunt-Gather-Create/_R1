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
 * Pure: assemble RawData from already-fetched inputs. For a wrapper subject
 * the fetched `weekItemsForEntity` are surfaced as `directWeekItems` and
 * render alongside child L1 rows (Hopdoddy 2026-05-28: previously the L2
 * sub-projects rendered while the wrapper's direct WIs went invisible). For
 * an L1 subject the items render directly as rows.
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
      directWeekItems: weekItemsForEntity,
    };
  }
  return {
    kind: "l1",
    entity: subject.project,
    client,
    children: weekItemsForEntity,
  };
}
