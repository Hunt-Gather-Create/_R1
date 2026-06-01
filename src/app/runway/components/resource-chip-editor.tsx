"use client";

/**
 * #70 commit 8a — polished chip editor for the dashboard edit modal's
 * Resources field. Replaces the free-text input that landed in b7c89f3.
 *
 * UX (per operator "please polish it" directive):
 *   - Each parsed `Role: Name` entry renders as a chip with an inline
 *     role dropdown + name input + × delete button.
 *   - "Add resource" button appends a new empty chip and focuses its
 *     name input so the operator can start typing immediately.
 *   - Backspace on an empty name field removes the chip (parity with ×).
 *   - Tab order flows: chip-1 role → chip-1 name → chip-1 ×
 *     → chip-2 role → ... → Add button.
 *
 * Fallback: when the existing value uses the advanced form
 * (`->` / `→` arrow sequences) or contains untagged entries the chip
 * editor can't represent without data loss, the component renders a
 * plain textarea instead. Operator can keep editing the raw string —
 * server-side `validateRoleTagOnResources` still enforces the role-prefix
 * contract on save.
 *
 * State model: parses `value` once on mount (chip-mode vs fallback
 * decision is sticky — switching modes mid-edit would be jarring), then
 * maintains internal `chips` state. Each edit serializes back to the
 * canonical `Role: Name, Role: Name` string and emits via `onChange`.
 * The parent (`EditDialogContent`) keeps the serialized form in its
 * `state.resources` for diff/save consistency.
 */

import {
  useCallback,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  ROLE_TAGS,
  parseResourceChips,
  serializeResourceChips,
  type ResourceChip,
} from "@/lib/runway/resource-tags";

type Mode =
  | { kind: "chips"; initial: ResourceChip[] }
  | { kind: "fallback" };

function decideMode(value: string): Mode {
  const trimmed = value.trim();
  if (trimmed === "") return { kind: "chips", initial: [] };
  const chips = parseResourceChips(trimmed);
  if (chips.length === 0) return { kind: "fallback" };
  return { kind: "chips", initial: chips };
}

export function ResourceChipEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  // Mode decision is sticky per mount: if the modal opened with an arrow
  // sequence we stay in textarea mode for the duration; the operator
  // can still rewrite the value entirely, and on save the server
  // validator gates anything malformed.
  const [mode] = useState<Mode>(() => decideMode(value));

  if (mode.kind === "fallback") {
    return (
      <textarea
        data-testid="resource-chip-fallback"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40"
        placeholder="AM: Jill, CD: Mark"
      />
    );
  }

  return <ChipsEditor initial={mode.initial} onChange={onChange} />;
}

function ChipsEditor({
  initial,
  onChange,
}: {
  initial: ResourceChip[];
  onChange: (next: string) => void;
}) {
  const [chips, setChips] = useState<ResourceChip[]>(initial);
  // Index of the chip whose name input should grab focus on next render.
  // -1 means no focus action pending. Set by Add + Backspace-delete so
  // the operator's typing flow lands in the right place.
  const [focusIndex, setFocusIndex] = useState<number>(-1);

  const emit = useCallback(
    (next: ResourceChip[]) => {
      setChips(next);
      onChange(serializeResourceChips(next));
    },
    [onChange],
  );

  function onRoleChange(idx: number, ev: ChangeEvent<HTMLSelectElement>) {
    const next = chips.map((c, i) =>
      i === idx ? { ...c, role: ev.target.value } : c,
    );
    emit(next);
  }

  function onNameChange(idx: number, ev: ChangeEvent<HTMLInputElement>) {
    const next = chips.map((c, i) =>
      i === idx ? { ...c, name: ev.target.value } : c,
    );
    emit(next);
  }

  function onRemove(idx: number) {
    const next = chips.filter((_, i) => i !== idx);
    emit(next);
  }

  function onAdd() {
    const next = [...chips, { role: "AM", name: "" }];
    setFocusIndex(next.length - 1);
    emit(next);
  }

  function onNameKeyDown(
    idx: number,
    ev: KeyboardEvent<HTMLInputElement>,
  ) {
    if (ev.key === "Backspace" && chips[idx].name === "") {
      ev.preventDefault();
      const next = chips.filter((_, i) => i !== idx);
      setFocusIndex(idx > 0 ? idx - 1 : -1);
      emit(next);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, idx) => (
          <ChipRow
            key={idx}
            chip={c}
            onRole={(ev) => onRoleChange(idx, ev)}
            onName={(ev) => onNameChange(idx, ev)}
            onRemove={() => onRemove(idx)}
            onNameKey={(ev) => onNameKeyDown(idx, ev)}
            shouldFocus={focusIndex === idx}
            onFocused={() => setFocusIndex(-1)}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        data-testid="resource-chip-add"
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:border-sky-500/40 hover:bg-sky-500/5 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
      >
        <span aria-hidden>+</span>
        <span>Add resource</span>
      </button>
    </div>
  );
}

function ChipRow({
  chip,
  onRole,
  onName,
  onRemove,
  onNameKey,
  shouldFocus,
  onFocused,
}: {
  chip: ResourceChip;
  onRole: (ev: ChangeEvent<HTMLSelectElement>) => void;
  onName: (ev: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  onNameKey: (ev: KeyboardEvent<HTMLInputElement>) => void;
  shouldFocus: boolean;
  onFocused: () => void;
}) {
  // Attach the focus side-effect to the input ref so the imperative
  // focus() lands after mount + after each render where shouldFocus
  // flips to true (Add or Backspace-delete cases).
  const inputRef = useCallback(
    (el: HTMLInputElement | null) => {
      if (el && shouldFocus) {
        el.focus();
        onFocused();
      }
    },
    [shouldFocus, onFocused],
  );

  return (
    <span
      data-testid="resource-chip"
      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/20 py-0.5 pl-1 pr-0.5 text-sm"
    >
      <select
        data-testid="resource-chip-role"
        value={ROLE_TAGS.includes(chip.role as never) ? chip.role : "AM"}
        onChange={onRole}
        aria-label="Role"
        className="rounded bg-transparent px-1 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500/40"
      >
        {ROLE_TAGS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <input
        ref={inputRef}
        data-testid="resource-chip-name"
        value={chip.name}
        onChange={onName}
        onKeyDown={onNameKey}
        aria-label="Name"
        placeholder="Name"
        className="w-24 rounded bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40"
      />
      <button
        type="button"
        onClick={onRemove}
        data-testid="resource-chip-remove"
        aria-label={`Remove ${chip.role}: ${chip.name || "(empty)"}`}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-sky-500/40"
      >
        <span aria-hidden>×</span>
      </button>
    </span>
  );
}
