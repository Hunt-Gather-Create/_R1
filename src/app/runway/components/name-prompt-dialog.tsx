"use client";

/**
 * Quick-intro name prompt — collects the operator's display name on first
 * dashboard write of a session and persists it via `useEditorName` so audit
 * rows carry per-operator attribution.
 *
 * Shared between the L2 edit pencil (#70) and the dashboard complete-checkbox
 * (#80). Both writes route through `updateWeekItemField`, whose idempotency
 * key includes `updatedBy`; threading a per-operator suffix is what keeps the
 * second click on the same (row, field, value) from colliding with the audit
 * row left by the first.
 *
 * The dialog is intentionally generic — it knows nothing about which write
 * is queued behind it. Callers wire `onSubmit` to advance their own state
 * machine (pencil opens the edit modal; checkbox fires the complete action).
 */

import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export function NamePromptDialog({
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
