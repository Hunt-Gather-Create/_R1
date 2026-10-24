/**
 * Field deltas for a matched pair: the §2.4 UPDATE policy per field, in
 * apply order.
 */
import { normalizeTitle } from "./ledger";
import { peopleDeltas } from "./people-delta";
import type { PeoplePlan } from "./role-map";
import type { RunwayClientBundle } from "./runway-read";
import type { FieldDelta, LeafTask } from "./types";

/**
 * §2.4 UPDATE policy applied to a matched pair. Only actionable deltas
 * become writes; protected statuses and completed-reverts become flags.
 */
export function statusDelta(
  sheetDerived: string,
  runway: string | null
): FieldDelta | null {
  const rw = runway ?? "scheduled"; // NULL readable as scheduled during rollout (schema comment)
  if (rw === sheetDerived) return null;
  if (rw === "blocked" || rw === "at-risk" || rw === "in-progress") {
    return {
      field: "status",
      sheet: sheetDerived,
      runway: rw,
      action: "protected-no-write",
    };
  }
  if (rw === "completed" && sheetDerived === "scheduled") {
    // Sheet checkbox FALSE but Runway completed → editorial call, flag only.
    return {
      field: "status",
      sheet: sheetDerived,
      runway: rw,
      action: "flag-for-review",
    };
  }
  if (rw === "scheduled" && sheetDerived === "completed") {
    return {
      field: "status",
      sheet: sheetDerived,
      runway: rw,
      action: "write",
    };
  }
  return {
    field: "status",
    sheet: sheetDerived,
    runway: rw,
    action: "flag-for-review",
  };
}

/**
 * §2.4-style UPDATE policy for weekOf (_R1#160). No protected states here:
 * a card in the wrong week bucket is corrected to the Monday the sheet row
 * derives, the same way a date correction is a plain write.
 */
export function weekOfDelta(
  sheetWeekOf: string | null,
  runwayWeekOf: string | null
): FieldDelta | null {
  if (!sheetWeekOf) return null;
  if (sheetWeekOf === (runwayWeekOf ?? null)) return null;
  return {
    field: "weekOf",
    sheet: sheetWeekOf,
    runway: runwayWeekOf ?? null,
    action: "write",
  };
}

/**
 * _R1#160, TP ruling 2026-09-22: the schedule sheet has no category column,
 * so it never authorizes a category value (same logic as rule R1). The tool
 * never plans a category on an update, ever. A non-null Runway category on
 * a matched row was put there by a person or an earlier tool run; null is
 * not a correction of it, it is a deletion on no authority. So a non-null
 * value is a flag naming the row and the value, never a write; a null
 * value has nothing to flag and nothing to write.
 */
export function categoryDelta(runwayCategory: string | null): FieldDelta | null {
  if (runwayCategory === null) return null;
  return {
    field: "category",
    sheet: null,
    runway: runwayCategory,
    action: "flag-for-review",
  };
}

/**
 * _R1#160, depends on #153: title is correctable only once identity, not
 * fuzzy title similarity, established the match. On a ledger-identity match
 * the sheet title is authoritative and gets written. On a fuzzy-only match,
 * title IS the key that produced the match. Writing over it fights the
 * matcher (the wrinkle the ticket names), so a drift is flagged, not fixed.
 */
export function titleDelta(
  sheetTitle: string,
  runwayTitle: string,
  matchedViaLedgerIdentity: boolean
): FieldDelta | null {
  if (normalizeTitle(sheetTitle) === normalizeTitle(runwayTitle)) return null;
  return {
    field: "title",
    sheet: sheetTitle,
    runway: runwayTitle,
    action: matchedViaLedgerIdentity ? "write" : "flag-for-review",
  };
}

function dateDeltas(
  leaf: LeafTask,
  wi: RunwayClientBundle["weekItems"][number]
): FieldDelta[] {
  const deltas: FieldDelta[] = [];
  // FORWARD date-move ordering, §2.8: endDate first, then startDate.
  // Emit in that order so payload applyOrder inherits it.
  if (leaf.endDate && leaf.endDate !== (wi.endDate ?? null)) {
    deltas.push({
      field: "endDate",
      sheet: leaf.endDate,
      runway: wi.endDate ?? null,
      action: "write",
    });
  }
  if (leaf.startDate && leaf.startDate !== (wi.startDate ?? null)) {
    deltas.push({
      field: "startDate",
      sheet: leaf.startDate,
      runway: wi.startDate ?? null,
      action: "write",
    });
  }
  return deltas;
}

/** Every field delta for a matched pair, in apply order. */
export function matchedDeltas(leaf: LeafTask, wi: RunwayClientBundle["weekItems"][number], viaLedger: boolean, people: PeoplePlan): FieldDelta[] {
  const single = [statusDelta(leaf.derivedStatus, wi.status), weekOfDelta(leaf.weekOf, wi.weekOf ?? null)];
  single.push(titleDelta(leaf.title, wi.title, viaLedger), categoryDelta(wi.category ?? null));
  return [...dateDeltas(leaf, wi), ...single.filter((d): d is FieldDelta => d !== null), ...peopleDeltas(people, wi)];
}
