"use client";

/**
 * #70 — pencil trigger + edit modal orchestrator for L2 cards.
 *
 * Mounts a ~14px pencil button absolute-positioned top-left of the parent
 * card. Click opens the edit modal — but if the operator hasn't named
 * themselves yet this session (no `runway_editor_name` cookie), a small
 * name-prompt modal fires first; on submit the name is cookie-stored and
 * the edit modal opens. Subsequent edits skip the prompt.
 *
 * Architecture: every L2 card mounts its own <EditPencil>; the modal
 * components mount on demand (Radix Dialog's open/close), so there's no
 * always-mounted DOM cost per card. Card layouts (DayItemCard,
 * L2MiniCard) need `relative` on the outer wrapper for the pencil's
 * absolute positioning to anchor correctly.
 *
 * Animation: Radix Dialog's default fade-and-scale overlay + content
 * transitions. Spec called for Framer Motion `layout` morph from the
 * source card; "or equivalent web-standard pattern" gives us this floor.
 * Adding framer-motion is a real scope balloon for a single-fast-follow
 * commit (TP-confirmed 2026-06-01).
 *
 * Optimistic UX: modal closes immediately on Save click. A sonner toast
 * fires "Saving [Title]..." → on success replaces with "Saved [Title]"
 * + Undo action + router.refresh() so the card visual updates. On
 * server error the toast replaces with "Save failed: <error>". Undo
 * replays the inverse via the same multi-field action.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  listProjectsForWeekItemAction,
  updateWeekItemFieldsAction,
} from "../actions";
import type {
  ProjectOption,
  WeekItemEditableField,
  WeekItemEditPatch,
} from "../action-types";
import { WEEK_ITEM_STATUSES } from "@/lib/runway/week-item-statuses";
import { WEEK_ITEM_CATEGORIES } from "@/lib/runway/week-item-categories";
import { useEditorName } from "./use-editor-name";
import { NamePromptDialog } from "./name-prompt-dialog";
import { ResourceChipEditor } from "./resource-chip-editor";

export type EditPencilItem = {
  id: string;
  title: string;
  owner?: string | null;
  resources?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  notes?: string | null;
  // #84 — the week item's own category (`week_items.category`, the
  // chip enum: delivery / review / kickoff / deadline / approval / launch).
  // Editable from this modal via the Category dropdown; pre-#84 the field
  // was read-only and mislabeled as a cascade from the parent project.
  category?: string | null;
  // #81 — the parent project's category value (`projects.category`,
  // surfaced read-only beside the WI category so operators see the
  // upstream context without conflating it with the editable WI chip).
  // Threaded in by commit 4; renders empty when undefined.
  parentCategory?: string | null;
  // Used to render the current project name in the picker's pre-load
  // placeholder so the operator sees context immediately even before
  // the option list arrives.
  parentProjectName?: string | null;
  // #70 commit 8b — current project id. When present, the modal renders
  // an editable <select> that loads same-client options via
  // listProjectsForWeekItemAction. Routing through linkWeekItemToProject
  // (the split action's `projectId` arg) preserves the client-mismatch
  // guard + cascading recompute.
  projectId?: string | null;
};

const DAY_OF_WEEK_OPTIONS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/**
 * #83 — when Undo fires from a save toast, the modal needs to reopen with
 * the operator's pre-Undo edits already applied so they can tweak + re-save
 * (or close without saving). `RestoreEdits` is what the parent EditPencil
 * passes back into the next mount of `EditDialogContent` so the form state
 * comes up populated with what was just saved+reverted, not the pristine
 * row values.
 */
type RestoreEdits = {
  edits: WeekItemEditPatch;
  /**
   * `undefined` = no project change was part of the original save (and we
   * don't restore one). A real string = restore to that selection. We never
   * restore to "" / null because clearing a week item's project isn't a
   * supported operation through the save action.
   */
  projectId: string | undefined;
};

export function EditPencil({ item }: { item: EditPencilItem }) {
  const [phase, setPhase] = useState<"closed" | "name-prompt" | "editing">(
    "closed",
  );
  // #83 — `null` for a fresh pencil click; populated when fireUndo's
  // onSuccess callback asks us to reopen with the captured payload.
  // Cleared on every fresh pencil click so a previous Undo's restore can't
  // leak into an unrelated edit session.
  const [restore, setRestore] = useState<RestoreEdits | null>(null);
  const { name, setName } = useEditorName();

  if (!item.id) return null;

  function openEdit() {
    setRestore(null);
    setPhase(name ? "editing" : "name-prompt");
  }

  function onPencilClick(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    openEdit();
  }

  function onPencilKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      openEdit();
    }
  }

  function reopenWithRestore(next: RestoreEdits) {
    setRestore(next);
    setPhase("editing");
  }

  return (
    <>
      <button
        type="button"
        onClick={onPencilClick}
        onKeyDown={onPencilKey}
        aria-label={`Edit ${item.title}`}
        data-testid="edit-pencil"
        // #82 — pencil sits top-right (was top-left) so it no longer
        // overlaps the account label that anchors each card header. Both
        // L2MiniCard and day-item-card render a flex-column at the right
        // edge (CompleteCheckbox + category chip); those columns add
        // `pt-6` so the checkbox sits below this button.
        className="absolute right-1.5 top-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-muted/40 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
      >
        <PencilGlyph />
      </button>
      <NamePromptDialog
        open={phase === "name-prompt"}
        onCancel={() => setPhase("closed")}
        onSubmit={(submitted) => {
          setName(submitted);
          setPhase("editing");
        }}
      />
      <EditDialog
        open={phase === "editing"}
        item={item}
        editorName={name}
        restore={restore}
        onClose={() => setPhase("closed")}
        onUndoSuccess={reopenWithRestore}
      />
    </>
  );
}

function PencilGlyph() {
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        d="M2 12 L4 11 L11 4 L10 2 L9 1 L2 8 L1 10 L2 12 Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Frozen-initial helper ────────────────────────────────────────────────

/**
 * Returns the result of `compute()` exactly once per mount and never
 * updates. P2 nit per TP review on b7c89f3 — `useState(() => ...)[0]`
 * reads as a frozen-state code smell; this helper makes the
 * "this never updates" contract explicit at the call site.
 */
function useFrozenInitial<T>(compute: () => T): T {
  return useState(compute)[0];
}

// ─── Edit modal ────────────────────────────────────────────────────────────

type EditState = Required<
  Pick<EditPencilItem, "title">
> & {
  owner: string;
  resources: string;
  startDate: string;
  endDate: string;
  dayOfWeek: string;
  status: string;
  // #84 — the WI's own category (`week_items.category`). "" = clear, written
  // to the DB as null via the diffEditState empty-to-null normalization.
  category: string;
  notes: string;
  // Tracked alongside the string-field state but emitted separately on
  // save (routes through linkWeekItemToProject, not updateWeekItemField).
  projectId: string;
};

function initialEditState(item: EditPencilItem): EditState {
  return {
    title: item.title ?? "",
    owner: item.owner ?? "",
    resources: item.resources ?? "",
    startDate: item.startDate ?? "",
    endDate: item.endDate ?? "",
    dayOfWeek: deriveDayOfWeek(item.startDate ?? "") ?? "",
    status: item.status ?? "",
    category: item.category ?? "",
    notes: item.notes ?? "",
    projectId: item.projectId ?? "",
  };
}

function deriveDayOfWeek(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return DAY_OF_WEEK_OPTIONS[(d.getUTCDay() + 6) % 7];
}

function validateEditState(state: EditState): string | null {
  if (!state.title.trim()) return "Title is required.";
  if (state.title.length > 280) return "Title must be 280 characters or fewer.";
  if (!state.owner.trim()) return "Owner is required.";
  if (state.notes.length > 280) return "Notes must be 280 characters or fewer.";
  if (state.startDate && state.endDate && state.startDate > state.endDate) {
    return "Start date must be on or before end date.";
  }
  if (state.status && !WEEK_ITEM_STATUSES.includes(state.status as never)) {
    return `Status must be one of: ${WEEK_ITEM_STATUSES.join(", ")}.`;
  }
  // #84 — empty string is the (clear) sentinel and passes through to
  // diffEditState which collapses it to null. Any other value must be
  // a known WI category enum member. The dropdown can't produce drift
  // on its own, but a forged DOM mutation would; the helper also
  // validates server-side as a second line of defense.
  if (
    state.category &&
    !WEEK_ITEM_CATEGORIES.includes(state.category as never)
  ) {
    return `Category must be one of: ${WEEK_ITEM_CATEGORIES.join(", ")}.`;
  }
  return null;
}

function diffEditState(
  initial: EditState,
  current: EditState,
): WeekItemEditPatch {
  const patch: WeekItemEditPatch = {};
  const fields: WeekItemEditableField[] = [
    "title",
    "owner",
    "resources",
    "startDate",
    "endDate",
    "dayOfWeek",
    "status",
    "category",
    "notes",
  ];
  for (const f of fields) {
    if (current[f] !== initial[f]) {
      const v = current[f].trim();
      patch[f] = v === "" ? null : v;
    }
  }
  return patch;
}

/**
 * Returns the new projectId iff the picker selection differs from the
 * initial value. Routes through the action's `projectId` arg
 * (linkWeekItemToProject) rather than the string-field patch.
 */
function diffProjectId(
  initial: EditState,
  current: EditState,
): string | undefined {
  if (current.projectId === initial.projectId) return undefined;
  if (current.projectId === "") return undefined; // clearing is not supported
  return current.projectId;
}

function EditDialog({
  open,
  item,
  editorName,
  restore,
  onClose,
  onUndoSuccess,
}: {
  open: boolean;
  item: EditPencilItem;
  editorName: string | null;
  restore: RestoreEdits | null;
  onClose: () => void;
  onUndoSuccess: (next: RestoreEdits) => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          data-testid="edit-dialog"
          className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[90vw] max-w-[600px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-5 text-foreground shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          {open ? (
            <EditDialogContent
              item={item}
              editorName={editorName}
              restore={restore}
              onClose={onClose}
              onUndoSuccess={onUndoSuccess}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * #83 — overlay the captured patch onto the row-derived initial state so
 * the form starts pre-populated with the operator's pre-Undo edits.
 * Defined-but-null in the patch maps to "" (the EditState shape uses ""
 * for the clear sentinel; diffEditState collapses "" back to null on
 * the next Save).
 */
function applyRestoreEdits(
  base: EditState,
  restore: RestoreEdits | null,
): EditState {
  if (!restore) return base;
  const next: EditState = { ...base };
  const fields: WeekItemEditableField[] = [
    "title",
    "owner",
    "resources",
    "startDate",
    "endDate",
    "dayOfWeek",
    "status",
    "category",
    "notes",
  ];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(restore.edits, f)) {
      next[f] = (restore.edits[f] ?? "") as string;
    }
  }
  if (restore.projectId !== undefined) {
    next.projectId = restore.projectId;
  }
  return next;
}

function EditDialogContent({
  item,
  editorName,
  restore,
  onClose,
  onUndoSuccess,
}: {
  item: EditPencilItem;
  editorName: string | null;
  restore: RestoreEdits | null;
  onClose: () => void;
  onUndoSuccess: (next: RestoreEdits) => void;
}) {
  // Mounted only when the dialog is open, unmounted on close — so the
  // initial snapshot is naturally fresh per open. `useFrozenInitial`
  // makes the "this never updates" contract explicit (P2 nit, TP review).
  // `initial` always reflects the row's actual stored values; `state` may
  // start pre-populated with restored edits (#83) so dirty-detection still
  // works against the row, not against the pre-Undo save.
  const initial = useFrozenInitial(() => initialEditState(item));
  const [state, setState] = useState<EditState>(() =>
    applyRestoreEdits(initial, restore),
  );
  const router = useRouter();

  const validationError = useMemo(() => validateEditState(state), [state]);
  const dirty = useMemo(
    () =>
      Object.keys(diffEditState(initial, state)).length > 0 ||
      diffProjectId(initial, state) !== undefined,
    [initial, state],
  );

  const onField = useCallback(
    <K extends keyof EditState>(key: K, value: EditState[K]) => {
      setState((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "startDate" && typeof value === "string") {
          const dow = deriveDayOfWeek(value);
          if (dow) next.dayOfWeek = dow;
        }
        return next;
      });
    },
    [],
  );

  function handleSave(event: FormEvent) {
    event.preventDefault();
    if (validationError) return;
    // Save button is disabled when editorName is empty (see Save's
    // `disabled={... || !editorName}` predicate). If this handler ever fires
    // with a null editorName, the disabled invariant has regressed — fail
    // loud instead of silently bailing.
    if (!editorName) {
      throw new Error("handleSave fired with null editorName; Save-disabled invariant regressed");
    }
    const patch = diffEditState(initial, state);
    const nextProjectId = diffProjectId(initial, state);
    if (Object.keys(patch).length === 0 && nextProjectId === undefined) {
      onClose();
      return;
    }
    onClose();
    fireSave(item, patch, nextProjectId, editorName, router, onUndoSuccess);
  }

  return (
    <>
      <Dialog.Title className="font-display text-lg font-semibold">
        Edit task
      </Dialog.Title>
      <Dialog.Description className="sr-only">
        Edit fields for {item.title}.
      </Dialog.Description>
      <form
        onSubmit={handleSave}
        className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <Field label="Title" colSpan={2}>
              <input
                value={state.title}
                onChange={(e) => onField("title", e.target.value)}
                data-testid="edit-field-title"
                className={inputClasses}
                maxLength={280}
              />
            </Field>
            <Field label="Owner">
              <input
                value={state.owner}
                onChange={(e) => onField("owner", e.target.value)}
                data-testid="edit-field-owner"
                className={inputClasses}
                placeholder="e.g. Jill"
              />
            </Field>
            <Field label="Status">
              <select
                value={state.status}
                onChange={(e) => onField("status", e.target.value)}
                data-testid="edit-field-status"
                className={inputClasses}
              >
                <option value="">(clear)</option>
                {WEEK_ITEM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start date">
              <input
                type="date"
                value={state.startDate}
                onChange={(e) => onField("startDate", e.target.value)}
                data-testid="edit-field-startDate"
                className={inputClasses}
              />
            </Field>
            <Field label="End date">
              <input
                type="date"
                value={state.endDate}
                onChange={(e) => onField("endDate", e.target.value)}
                data-testid="edit-field-endDate"
                className={inputClasses}
              />
            </Field>
            <Field label="Day of week">
              <select
                value={state.dayOfWeek}
                onChange={(e) => onField("dayOfWeek", e.target.value)}
                data-testid="edit-field-dayOfWeek"
                className={inputClasses}
              >
                <option value="">(clear)</option>
                {DAY_OF_WEEK_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select
                value={state.category}
                onChange={(e) => onField("category", e.target.value)}
                data-testid="edit-field-category"
                className={inputClasses}
              >
                <option value="">(clear)</option>
                {WEEK_ITEM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Project category">
              <input
                value={item.parentCategory ?? ""}
                readOnly
                data-testid="edit-field-parentCategory"
                className={`${inputClasses} cursor-not-allowed bg-muted/30 text-muted-foreground`}
              />
            </Field>
            <Field label="Project" colSpan={2}>
              <ProjectPicker
                weekItemId={item.id}
                fallbackName={item.parentProjectName ?? ""}
                value={state.projectId}
                onChange={(next) => onField("projectId", next)}
              />
            </Field>
            <Field label="Resources" colSpan={2}>
              <div data-testid="edit-field-resources">
                <ResourceChipEditor
                  value={state.resources}
                  onChange={(next) => onField("resources", next)}
                />
              </div>
            </Field>
            <Field label="Notes" colSpan={2}>
              <textarea
                value={state.notes}
                onChange={(e) => onField("notes", e.target.value)}
                data-testid="edit-field-notes"
                rows={3}
                maxLength={280}
                className={inputClasses}
              />
              <p className="mt-1 text-right text-[10px] text-muted-foreground/60">
                {state.notes.length} / 280
              </p>
            </Field>
            {validationError ? (
              <p
                data-testid="edit-validation-error"
                className="sm:col-span-2 text-sm text-red-500"
              >
                {validationError}
              </p>
            ) : null}
            <div className="sm:col-span-2 mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                data-testid="edit-cancel"
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/30"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={Boolean(validationError) || !dirty || !editorName}
                data-testid="edit-save"
                className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </form>
    </>
  );
}

const inputClasses =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40";

function Field({
  label,
  colSpan,
  children,
}: {
  label: string;
  colSpan?: 1 | 2;
  children: React.ReactNode;
}) {
  const className =
    colSpan === 2 ? "sm:col-span-2" : undefined;
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

// ─── Save side-effect (lives outside the component so the closure isn't
// captured by render and the toast survives modal unmount) ────────────────

/**
 * P1.2 toast dedupe key. Sonner toasts with the same id collapse — a
 * second edit on the same row replaces toast #1's "Saved" surface
 * (including its stale `previousValues` Undo closure), so clicking Undo
 * after a second save can't silently revert past the user's most recent
 * intent. Matches the pattern complete-checkbox lands post-9699ab2.
 */
function saveToastId(weekItemId: string): string {
  return `save-${weekItemId}`;
}

async function fireSave(
  item: EditPencilItem,
  patch: WeekItemEditPatch,
  nextProjectId: string | undefined,
  updatedBy: string,
  router: ReturnType<typeof useRouter>,
  onUndoSuccess: (next: RestoreEdits) => void,
): Promise<void> {
  const toastId = saveToastId(item.id);
  toast.loading(`Saving ${item.title}…`, { id: toastId });
  const result = await updateWeekItemFieldsAction({
    weekItemId: item.id,
    updatedBy,
    fields: patch,
    ...(nextProjectId !== undefined ? { projectId: nextProjectId } : {}),
  });
  if (!result.ok) {
    toast.error(`Save failed: ${result.error}`, { id: toastId });
    return;
  }
  const previousValues = result.previousValues;
  const previousProjectId =
    result.previousProjectId ?? null;
  toast.success(`Saved ${item.title}`, {
    id: toastId,
    duration: 8000,
    // PR #111 Llama F1: don't register `router.refresh()` on onAutoClose
    // — the immediate call at the end of this function already covers the
    // post-save RSC re-fetch. Registering it again would fire a second
    // refresh 8s later when the toast auto-closes without action. The
    // `complete-checkbox` path is different (modal stays unmounted during
    // its undo window, so its onAutoClose IS the only refresh trigger).
    action: {
      label: "Undo",
      // #83 — capture the operator's pre-Undo edits in closure so the
      // post-revert `onUndoSuccess` callback can reopen the modal with
      // them pre-applied. The captured payload is exactly what the
      // user just submitted; combined with the post-revert row state
      // it produces the same form the user was looking at before Save.
      onClick: () =>
        fireUndo(
          item,
          previousValues,
          previousProjectId,
          updatedBy,
          router,
          () => onUndoSuccess({ edits: patch, projectId: nextProjectId }),
        ),
    },
  });
  router.refresh();
}

async function fireUndo(
  item: EditPencilItem,
  previousValues: WeekItemEditPatch,
  previousProjectId: string | null,
  updatedBy: string,
  router: ReturnType<typeof useRouter>,
  onSuccess: () => void,
): Promise<void> {
  // Reuse the same id as the originating save toast so the in-flight
  // "Saved" surface is replaced rather than stacked.
  const toastId = saveToastId(item.id);
  toast.loading(`Reverting ${item.title}…`, { id: toastId });
  const result = await updateWeekItemFieldsAction({
    weekItemId: item.id,
    updatedBy,
    fields: previousValues,
    // Only re-parent on undo when the original save changed the project
    // AND there's a non-null previous to restore — clearing a week item's
    // project isn't a supported operation through this action.
    ...(previousProjectId ? { projectId: previousProjectId } : {}),
  });
  if (!result.ok) {
    // #83 — leave the modal closed on Undo failure. The DB still holds
    // the saved value, so reopening with pre-Undo edits would mislead
    // the operator about what state the row is in.
    toast.error(`Could not undo: ${result.error}`, { id: toastId });
    return;
  }
  toast.success(`Reverted ${item.title}`, { id: toastId, duration: 4000 });
  router.refresh();
  onSuccess();
}

// ─── Project picker ───────────────────────────────────────────────────────

/**
 * Loads the same-client project list on mount and renders a <select>
 * pre-filled to `value`. Mirrors the Slack flow's project picker:
 * scope to the row's client, drop terminal-status projects, sort by
 * the helper's existing `sortOrder`. The action layer enforces the
 * client-mismatch guard + cascading recompute on save.
 *
 * Loading state: disabled <select> with a "Loading projects…" placeholder.
 * Error state: disabled <select> showing the row's `fallbackName` so the
 * operator still sees context. The split action lets them retry by
 * cancelling + reopening the modal, or saving without touching the
 * project (a no-op since the picker stayed disabled).
 */
function ProjectPicker({
  weekItemId,
  fallbackName,
  value,
  onChange,
}: {
  weekItemId: string;
  fallbackName: string;
  value: string;
  onChange: (next: string) => void;
}) {
  type LoadState =
    | { kind: "loading" }
    | { kind: "ready"; projects: ProjectOption[] }
    | { kind: "error"; message: string };

  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    listProjectsForWeekItemAction({ weekItemId }).then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ kind: "error", message: result.error });
        } else {
          setState({ kind: "ready", projects: result.projects });
        }
      },
      (err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [weekItemId]);

  if (state.kind === "loading") {
    return (
      <select
        data-testid="edit-field-project"
        disabled
        value=""
        onChange={() => {}}
        className={`${inputClasses} cursor-wait bg-muted/30 text-muted-foreground`}
      >
        <option value="">
          {fallbackName
            ? `Loading projects… (current: ${fallbackName})`
            : "Loading projects…"}
        </option>
      </select>
    );
  }

  if (state.kind === "error") {
    return (
      <select
        data-testid="edit-field-project"
        disabled
        value=""
        onChange={() => {}}
        className={`${inputClasses} cursor-not-allowed bg-muted/30 text-muted-foreground`}
        title={state.message}
      >
        <option value="">
          {fallbackName || "(project load failed)"}
        </option>
      </select>
    );
  }

  // P1.3 (TP code-review on 856b7dd): if the WI's current parent is
  // terminal-status, the server action filters it out — but the
  // operator should still see the truth, not the first loaded option.
  // Prepend the current parent as a disabled "(current — closed)" entry
  // so the <select> value matches what's in state.
  const currentInList = state.projects.some((p) => p.id === value);
  const showTerminalCurrent = value !== "" && !currentInList;
  return (
    <select
      data-testid="edit-field-project"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClasses}
    >
      {showTerminalCurrent ? (
        <option value={value} disabled>
          {fallbackName
            ? `${fallbackName} (current — closed)`
            : "(current — closed)"}
        </option>
      ) : null}
      {state.projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
