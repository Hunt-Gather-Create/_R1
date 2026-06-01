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
 *
 * Editor-name gate (#80): the underlying `updateWeekItemField` idempotency
 * key is `(updateType, weekItemId, field, newValue, updatedBy)`. Before
 * #80, every dashboard click wrote a fixed `updatedBy="runway:dashboard"`,
 * so the second click on the same row+value collided with the audit row
 * left by the first and silently no-op'd. We now mirror the pencil's
 * `useEditorName` + name-prompt flow: first click in a session opens the
 * intro prompt, subsequent clicks reuse the cookie-stored name and pass
 * it through to the server action so the idem-key is unique per operator.
 */

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setWeekItemStatusAction } from "../actions";
import { useEditorName } from "./use-editor-name";
import { NamePromptDialog } from "./name-prompt-dialog";

const TERMINAL = new Set(["completed", "canceled"]);

// Per-row sonner id. Same pattern as the modal's `saveToastId` — keeps a
// failure toast from stacking on top of the row's existing complete/Undo
// surface (sonner replaces any in-flight toast carrying the same id).
function checkboxToastId(weekItemId: string): string {
  return `checkbox-${weekItemId}`;
}

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
  // Name-prompt phase. The first click in a session with no editor-name
  // cookie opens the intro prompt; the action only fires after the operator
  // submits a name. Cancelling the prompt leaves the visual state untouched
  // (we don't flip optimistic until the action is actually queued).
  const [phase, setPhase] = useState<"idle" | "name-prompt">("idle");
  const { name, setName } = useEditorName();
  const router = useRouter();
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

  function requestComplete() {
    if (pending) return;
    // Re-clicking the box after it's already flipped optimistic-completed
    // would refire the server action and then surface an Undo toast whose
    // `previousStatus` is itself "completed" — silent no-op on click,
    // operator sees a toast that doesn't do anything. Skip.
    if (optimistic === "completed") return;
    if (!name) {
      setPhase("name-prompt");
      return;
    }
    complete(name);
  }

  function complete(editorName: string) {
    const previousVisualStatus = status ?? null;
    setOptimistic("completed");
    const toastId = checkboxToastId(idRef.current!);
    startTransition(async () => {
      const result = await setWeekItemStatusAction({
        weekItemId: idRef.current!,
        newStatus: "completed",
        editorName,
      });
      if (!result.ok) {
        setOptimistic("idle");
        toast.error(`Could not mark complete: ${result.error}`, { id: toastId });
        return;
      }
      // Server returns the row's previous status. If for any reason it
      // differs from what the card displayed (e.g. row was already
      // completed via another path), fall back to that authoritative
      // value for undo so we don't re-toggle into a stale state.
      const undoTarget = result.previousStatus ?? previousVisualStatus;
      toast(`${title} marked complete`, {
        id: toastId,
        duration: 8000,
        // #79: revalidatePath in the server action only marks the RSC cache
        // stale on the server; the client never refetches without an explicit
        // router.refresh(). Fire it when the undo window expires without
        // action so the card drops out of In Flight as expected.
        onAutoClose: () => router.refresh(),
        action: {
          label: "Undo",
          onClick: () => revertTo(undoTarget, editorName),
        },
      });
    });
  }

  function revertTo(target: string | null, editorName: string) {
    setOptimistic("idle");
    const toastId = checkboxToastId(idRef.current!);
    startTransition(async () => {
      const result = await setWeekItemStatusAction({
        weekItemId: idRef.current!,
        newStatus: target,
        editorName,
      });
      if (!result.ok) {
        // Couldn't revert server-side — re-flip optimistic to completed
        // so the visual state matches what the DB still holds, and tell
        // the user the undo failed.
        setOptimistic("completed");
        toast.error(`Could not undo: ${result.error}`, { id: toastId });
        return;
      }
      // #79: optimistic state is back to "idle" but the parent's RSC tree
      // still has the row filtered out (it was in the "completed" window
      // when the parent last rendered). router.refresh() refetches so the
      // card reappears unchecked in In Flight.
      router.refresh();
    });
  }

  function onClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    requestComplete();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      requestComplete();
    }
  }

  const checked = optimistic === "completed";
  const ariaLabel = checked
    ? `${title} marked complete`
    : `Mark ${title} complete`;
  return (
    <>
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
      <NamePromptDialog
        open={phase === "name-prompt"}
        onCancel={() => setPhase("idle")}
        onSubmit={(submitted) => {
          setName(submitted);
          setPhase("idle");
          complete(submitted);
        }}
      />
    </>
  );
}
