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
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateWeekItemFieldsAction } from "../actions";
import type {
  WeekItemEditableField,
  WeekItemEditPatch,
} from "../action-types";
import { WEEK_ITEM_STATUSES } from "@/lib/runway/week-item-statuses";
import { useEditorName } from "./use-editor-name";

export type EditPencilItem = {
  id: string;
  title: string;
  owner?: string | null;
  resources?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: string | null;
  notes?: string | null;
  // Read-only display fields — category cascades from project; project
  // edit defers to #11's cascading picker (TP-confirmed 2026-06-01).
  category?: string | null;
  parentProjectName?: string | null;
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

export function EditPencil({ item }: { item: EditPencilItem }) {
  const [phase, setPhase] = useState<"closed" | "name-prompt" | "editing">(
    "closed",
  );
  const { name, setName } = useEditorName();

  if (!item.id) return null;

  function onPencilClick(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setPhase(name ? "editing" : "name-prompt");
  }

  function onPencilKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      setPhase(name ? "editing" : "name-prompt");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onPencilClick}
        onKeyDown={onPencilKey}
        aria-label={`Edit ${item.title}`}
        data-testid="edit-pencil"
        className="absolute left-1.5 top-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-muted/40 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
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
        onClose={() => setPhase("closed")}
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

// ─── Name prompt ───────────────────────────────────────────────────────────

/**
 * Outer Radix Dialog shell — same content-split pattern EditDialog uses.
 * The inner form only mounts when `open=true`, so the input value resets
 * naturally on the open→closed→open cycle without a useEffect (P2 nit
 * per TP review on b7c89f3).
 */
function NamePromptDialog({
  open,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          data-testid="name-prompt-dialog"
          className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-5 text-foreground shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          {open ? (
            <NamePromptContent onCancel={onCancel} onSubmit={onSubmit} />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NamePromptContent({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputId = useId();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <>
      <Dialog.Title className="font-display text-lg font-semibold">
        Quick intro
      </Dialog.Title>
      <Dialog.Description className="mt-1 text-sm text-muted-foreground">
        Your name shows up in the audit log next to anything you edit
        from the dashboard. We&apos;ll remember it on this browser.
      </Dialog.Description>
      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <div>
          <label
            htmlFor={inputId}
            className="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Name
          </label>
          <input
            id={inputId}
            data-testid="name-prompt-input"
            autoFocus
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setValue(e.target.value)
            }
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            placeholder="e.g. Jason Burks"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/30"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            data-testid="name-prompt-submit"
            className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </form>
    </>
  );
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
  notes: string;
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
    notes: item.notes ?? "",
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

function EditDialog({
  open,
  item,
  editorName,
  onClose,
}: {
  open: boolean;
  item: EditPencilItem;
  editorName: string | null;
  onClose: () => void;
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
              onClose={onClose}
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EditDialogContent({
  item,
  editorName,
  onClose,
}: {
  item: EditPencilItem;
  editorName: string | null;
  onClose: () => void;
}) {
  // Mounted only when the dialog is open, unmounted on close — so the
  // initial snapshot is naturally fresh per open. `useFrozenInitial`
  // makes the "this never updates" contract explicit (P2 nit, TP review).
  const initial = useFrozenInitial(() => initialEditState(item));
  const [state, setState] = useState<EditState>(initial);
  const router = useRouter();

  const validationError = useMemo(() => validateEditState(state), [state]);
  const dirty = useMemo(
    () => Object.keys(diffEditState(initial, state)).length > 0,
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
    if (!editorName) return;
    const patch = diffEditState(initial, state);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    onClose();
    fireSave(item, patch, editorName, router);
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
            <Field label="Category (cascades from project)">
              <input
                value={item.category ?? ""}
                readOnly
                data-testid="edit-field-category"
                className={`${inputClasses} cursor-not-allowed bg-muted/30 text-muted-foreground`}
              />
            </Field>
            <Field label="Project (edit via cascading picker — see #11)" colSpan={2}>
              <input
                value={item.parentProjectName ?? ""}
                readOnly
                data-testid="edit-field-project"
                className={`${inputClasses} cursor-not-allowed bg-muted/30 text-muted-foreground`}
              />
            </Field>
            <Field label="Resources (format: AM: Jill, CD: Mark)" colSpan={2}>
              <input
                value={state.resources}
                onChange={(e) => onField("resources", e.target.value)}
                data-testid="edit-field-resources"
                className={inputClasses}
                placeholder="AM: Jill, CD: Mark"
              />
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
  updatedBy: string,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  const toastId = saveToastId(item.id);
  toast.loading(`Saving ${item.title}…`, { id: toastId });
  const result = await updateWeekItemFieldsAction({
    weekItemId: item.id,
    updatedBy,
    fields: patch,
  });
  if (!result.ok) {
    toast.error(`Save failed: ${result.error}`, { id: toastId });
    return;
  }
  const previousValues = result.previousValues;
  toast.success(`Saved ${item.title}`, {
    id: toastId,
    duration: 8000,
    onAutoClose: () => router.refresh(),
    action: {
      label: "Undo",
      onClick: () => fireUndo(item, previousValues, updatedBy, router),
    },
  });
  router.refresh();
}

async function fireUndo(
  item: EditPencilItem,
  previousValues: WeekItemEditPatch,
  updatedBy: string,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  // Reuse the same id as the originating save toast so the in-flight
  // "Saved" surface is replaced rather than stacked.
  const toastId = saveToastId(item.id);
  toast.loading(`Reverting ${item.title}…`, { id: toastId });
  const result = await updateWeekItemFieldsAction({
    weekItemId: item.id,
    updatedBy,
    fields: previousValues,
  });
  if (!result.ok) {
    toast.error(`Could not undo: ${result.error}`, { id: toastId });
    return;
  }
  toast.success(`Reverted ${item.title}`, { id: toastId, duration: 4000 });
  router.refresh();
}
