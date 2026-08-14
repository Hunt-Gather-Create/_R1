/**
 * M1 E3 (#103) apply-writes executor.
 *
 * Dry-run is the DEFAULT: calling applyPayloads without the `apply` flag
 * returns the sorted planned list and calls no operations. The apply/write
 * path dispatches inside a withBatchId(runId) ALS scope so every operation
 * write is tagged with the run id.
 */

import type { SyncPayload } from "./types";
import type { createRunwayDb } from "../lib/run-script";
import { withBatchId } from "../../src/lib/runway/runway-als";
import {
  createWeekItem,
  updateWeekItemField,
  addProject,
} from "../../src/lib/runway/operations";
import { applyReviewQueue } from "../../src/lib/db/runway-schema";
import { generateId } from "../../src/lib/runway/operations-utils";

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

  return withBatchId(opts.runId, async () => {
    const applied: { payload: SyncPayload; response: unknown }[] = [];
    const review: SyncPayload[] = [];

    for (const p of planned) {
      // Route to review queue when requiresReview (unless force) or op is flag-for-review
      if ((p.requiresReview && !opts.force) || p.op === "flag-for-review") {
        await db.insert(applyReviewQueue).values({
          id: generateId(),
          runId: opts.runId,
          payloadJson: JSON.stringify(p),
          createdAt: new Date(),
        });
        review.push(p);
        continue;
      }

      let response: unknown;
      switch (p.op) {
        case "createWeekItem":
          response = await createWeekItem(
            p.params as Parameters<typeof createWeekItem>[0],
          );
          break;
        case "updateWeekItemField":
          response = await updateWeekItemField(
            p.params as Parameters<typeof updateWeekItemField>[0],
          );
          break;
        case "addProject":
          response = await addProject(
            p.params as Parameters<typeof addProject>[0],
          );
          break;
        default:
          // Exhaustive — flag-for-review is handled above
          response = { ok: false, error: `Unknown op: ${p.op}` };
      }

      applied.push({ payload: p, response });
    }

    return { dryRun: false, planned, applied, review };
  });
}
