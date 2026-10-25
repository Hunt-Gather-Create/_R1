/**
 * Owner and resources deltas for a matched row, and the per-row plan the
 * payloads and the parity harness read. Values come only from planPeople over staffing.
 */
import { planPeople, type PeoplePlan } from "./role-map";
import type { Staffing } from "./staffing";
import { refusedLabels } from "./refusal-record";
import { PEOPLE_FIELDS } from "./sync-fields";
import type { FieldDelta, RowDiff } from "./types";

/**
 * An empty Runway field gets a write. A field a person already filled is
 * flagged, never overwritten, the same protection category gets.
 */
export function peopleDeltas(
  plan: PeoplePlan,
  wi: { owner?: string | null; resources?: string | null }
): FieldDelta[] {
  if (plan.kind !== "planned") return [];
  const deltas: FieldDelta[] = [];
  for (const field of PEOPLE_FIELDS) {
    const runway = wi[field] ?? null;
    if (runway === plan[field]) continue;
    deltas.push({
      field,
      sheet: plan[field],
      runway,
      action: runway === null ? "write" : "flag-for-review",
    });
  }
  return deltas;
}

/** Sets the row's plan and returns how many refusals it adds to the run counter. */
export function attachPeople(rd: RowDiff, clientSlug: string, staffing: Staffing): number {
  if (!rd.leaf) return 0;
  rd.people = planPeople(rd.leaf.resource, clientSlug, staffing);
  return refusedLabels(rd).length;
}
