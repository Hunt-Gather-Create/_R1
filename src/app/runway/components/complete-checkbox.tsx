"use client";

/**
 * Card checkbox affordance — #9 (partial #67).
 *
 * One physical click on the card marks the underlying weekItem complete.
 * Pattern: optimistic UI flip first, fire the server action immediately,
 * surface a sonner toast with an 8 s Undo action. Undo replays the action
 * with the previous status captured in closure. Server failures show an
 * error toast and revert the optimistic state.
 *
 * Render-conditions:
 *   - Missing `weekItemId` → returns null (no id ⇒ no write path).
 *   - Status already in {completed, canceled} → returns null (no point
 *     re-flipping a terminal state via this affordance).
 *
 * Used by `L2MiniCard` (By Account + Status View) and `DayItemCard` (This
 * Week). Both surfaces pass the same shape; this component owns the
 * optimistic state + toast lifecycle in one place.
 */

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import { setWeekItemStatusAction } from "../actions";

const TERMINAL = new Set(["completed", "canceled"]);

export function CompleteCheckbox({
  weekItemId,
  title,
  status,
  className,
}: {
  weekItemId: string | undefined;
  title: string;
  status: string | null | undefined;
  className?: string;
}) {
  // Optimistic visual state — flips on click before the server confirms.
  const [optimistic, setOptimistic] = useState<"idle" | "completed">(
    status === "completed" ? "completed" : "idle",
  );
  const [pending, startTransition] = useTransition();
  // LlamaPReview P2 (PR #110): the undo callback in the toast closure
  // captured `weekItemId` as a prop value at toast-creation time. If the
  // parent re-rendered the same React node with a different id before the
  // user clicked Undo, the closure would target the stale id. The card key
  // upstream is `item.id`, so this is theoretical — but a ref is cheap and
  // makes the guarantee structural rather than positional.
  const idRef = useRef(weekItemId);
  useEffect(() => {
    idRef.current = weekItemId;
  }, [weekItemId]);

  if (!weekItemId) return null;
  // Don't render the affordance once the row is already terminal —
  // upstream filters drop completed/canceled cards from most surfaces
  // anyway, so this is a defensive guard for any view that doesn't.
  if (status != null && TERMINAL.has(status)) return null;

  function complete() {
    if (pending) return;
    // Re-clicking the box after it's already flipped optimistic-completed
    // would refire the server action and then surface an Undo toast whose
    // `previousStatus` is itself "completed" — silent no-op on click,
    // operator sees a toast that doesn't do anything. Skip.
    if (optimistic === "completed") return;
    const previousVisualStatus = status ?? null;
    setOptimistic("completed");
    startTransition(async () => {
      const result = await setWeekItemStatusAction({
        weekItemId: idRef.current!,
        newStatus: "completed",
      });
      if (!result.ok) {
        setOptimistic("idle");
        toast.error(`Could not mark complete: ${result.error}`);
        return;
      }
      // Server returns the row's previous status. If for any reason it
      // differs from what the card displayed (e.g. row was already
      // completed via another path), fall back to that authoritative
      // value for undo so we don't re-toggle into a stale state.
      const undoTarget = result.previousStatus ?? previousVisualStatus;
      toast(`${title} marked complete`, {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () => revertTo(undoTarget),
        },
      });
    });
  }

  function revertTo(target: string | null) {
    setOptimistic("idle");
    startTransition(async () => {
      const result = await setWeekItemStatusAction({
        weekItemId: idRef.current!,
        newStatus: target,
      });
      if (!result.ok) {
        // Couldn't revert server-side — re-flip optimistic to completed
        // so the visual state matches what the DB still holds, and tell
        // the user the undo failed.
        setOptimistic("completed");
        toast.error(`Could not undo: ${result.error}`);
      }
    });
  }

  function onClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    complete();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      complete();
    }
  }

  const checked = optimistic === "completed";
  const ariaLabel = checked
    ? `${title} marked complete`
    : `Mark ${title} complete`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-testid="complete-checkbox"
      data-checked={checked ? "true" : "false"}
      disabled={pending && !checked}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500/40 ${
        checked
          ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
          : "border-border bg-background/60 text-transparent hover:border-emerald-500/60 hover:text-emerald-400"
      } ${className ?? ""}`}
    >
      <svg
        viewBox="0 0 12 12"
        aria-hidden="true"
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path d="M2 6.5 L5 9 L10 3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
