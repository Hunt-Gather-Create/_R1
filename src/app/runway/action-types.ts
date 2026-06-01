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
  | "category"
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

/**
 * Project-picker option for the dashboard edit modal (#70 commit 8b).
 * Scoped to the same client as the source week item. `parentProjectId`
 * is exposed so the UI can render an L1 / L2 hierarchy hint without
 * a second round trip; the modal's first cut is a flat <select>.
 */
export type ProjectOption = {
  id: string;
  name: string;
  parentProjectId: string | null;
};

export type ListProjectsForWeekItemResult =
  | { ok: true; projects: ProjectOption[] }
  | { ok: false; error: string };
