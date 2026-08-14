/**
 * M1 E3 (#103) apply-writes executor.
 *
 * Dry-run is the DEFAULT: calling applyPayloads without the `apply` flag
 * returns the sorted planned list and calls no operations. The apply/write
 * path lands in a later task (Task 3+).
 */

import type { SyncPayload } from "./types";
import type { createRunwayDb } from "../lib/run-script";

export interface ApplyOpts {
  runId: string;
  apply?: boolean;
  force?: boolean;
}

export interface ApplyResult {
  dryRun: boolean;
  planned: SyncPayload[];
  applied: { payload: SyncPayload; response: unknown }[];
  review: SyncPayload[];
}

export async function applyPayloads(
  db: ReturnType<typeof createRunwayDb>["db"],
  payloads: SyncPayload[],
  opts: ApplyOpts,
): Promise<ApplyResult> {
  const planned = [...payloads].sort((a, b) => a.applyOrder - b.applyOrder);

  if (!opts.apply) {
    return { dryRun: true, planned, applied: [], review: [] };
  }

  throw new Error("apply path not implemented (Task 3)");
}
