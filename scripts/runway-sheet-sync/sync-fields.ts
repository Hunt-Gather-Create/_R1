/**
 * The one owner of week item field names in the sync. Every list is a
 * subset of WEEK_ITEM_FIELDS, which src/lib/runway owns.
 */
import type { WeekItemField } from "../../src/lib/runway/operations-utils";

/** Every field a FieldDelta can name, in the report's comparison order. */
export const SYNC_FIELDS = [
  "status",
  "startDate",
  "endDate",
  "weekOf",
  "title",
  "owner",
  "resources",
  "category",
] as const satisfies readonly WeekItemField[];
export type SyncField = (typeof SYNC_FIELDS)[number];

/** Owner and resources: the two fields only the role map plans. */
export const PEOPLE_FIELDS = ["owner", "resources"] as const satisfies readonly SyncField[];
export type PeopleField = (typeof PEOPLE_FIELDS)[number];

export function isPeopleField(field: string): field is PeopleField {
  return (PEOPLE_FIELDS as readonly string[]).includes(field);
}

/** The sheet has no category column, so an update never compares category. */
export const NEVER_COMPARED_FIELDS = ["category"] as const satisfies readonly SyncField[];

/** Fields a matched row compares, in report order. */
export const COMPARED_FIELDS: SyncField[] = SYNC_FIELDS.filter(
  (f) => !(NEVER_COMPARED_FIELDS as readonly SyncField[]).includes(f)
);

/**
 * The fields the parity harness compares. title and weekOf are left out on
 * purpose: they are match keys, never correction targets.
 */
export const PARITY_FIELDS = [
  "status",
  "startDate",
  "endDate",
  "category",
  "owner",
  "resources",
] as const satisfies readonly SyncField[];
export type ParityField = (typeof PARITY_FIELDS)[number];
