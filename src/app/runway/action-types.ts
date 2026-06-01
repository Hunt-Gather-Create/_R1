/**
 * Shared types for runway server actions. Lives in a separate module
 * from `actions.ts` because that file carries the `"use server"`
 * directive, and re-exporting non-function values from a server-actions
 * file pulls server-only deps (drizzle-orm, node:async_hooks) into the
 * client bundle via the type import. Components import the types from
 * here; only the action functions come from `actions.ts`.
 */

export type WeekItemEditableField =
  | "title"
  | "owner"
  | "resources"
  | "startDate"
  | "endDate"
  | "dayOfWeek"
  | "status"
  | "notes";

export type WeekItemEditPatch = Partial<
  Record<WeekItemEditableField, string | null>
>;

export type UpdateWeekItemFieldsResult =
  | { ok: true; previousValues: WeekItemEditPatch }
  | { ok: false; error: string };

export type SetWeekItemStatusResult =
  | { ok: true; previousStatus: string | null }
  | { ok: false; error: string };
