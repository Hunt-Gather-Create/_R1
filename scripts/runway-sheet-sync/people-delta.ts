/**
 * Owner and resources deltas for a matched row, and the per-row plan the
 * payloads and the parity harness read. Values come only from role-map.ts.
 */
import { planPeople, type PeoplePlan, type RoleMap } from "./role-map";
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
  for (const field of ["owner", "resources"] as const) {
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
export function attachPeople(rd: RowDiff, clientSlug: string, roleMap: RoleMap): number {
  if (!rd.leaf) return 0;
  rd.people = planPeople(rd.leaf.resource, clientSlug, roleMap);
  return rd.people.kind === "refused" ? rd.people.unmapped.length : 0;
}
