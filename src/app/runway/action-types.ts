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

export type UpdateWeekItemFieldsInput = {
  weekItemId: string;
  updatedBy: string;
  /** String fields routed through `updateWeekItemField`. */
  fields: WeekItemEditPatch;
  /**
   * Project re-parenting routes through `linkWeekItemToProject` instead
   * (separate helper with a client-mismatch guard + cascading recompute).
   * Omitted = no project change. `null` is not a valid value — the helper
   * requires a real projectId; clearing a week item's project isn't a
   * supported operation from the dashboard.
   */
  projectId?: string;
};

export type UpdateWeekItemFieldsResult =
  | {
      ok: true;
      previousValues: WeekItemEditPatch;
      /** Present iff the input included `projectId`. */
      previousProjectId?: string | null;
    }
  | { ok: false; error: string };

export type SetWeekItemStatusResult =
  | { ok: true; previousStatus: string | null }
  | { ok: false; error: string };
