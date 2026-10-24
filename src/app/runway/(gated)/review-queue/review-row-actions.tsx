"use client";

import { useActionState } from "react";
import {
  approveReviewQueueRowAction,
  dismissReviewQueueRowAction,
  type ReviewQueueActionState,
} from "./actions";

const BUTTON =
  "rounded-md px-3 py-1.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

/** Approve and Dismiss buttons for one pending queue row. */
export function ReviewRowActions({ id }: { id: string }) {
  const [approveState, approve, approving] = useActionState<ReviewQueueActionState, FormData>(
    approveReviewQueueRowAction,
    null,
  );
  const [dismissState, dismiss, dismissing] = useActionState<ReviewQueueActionState, FormData>(
    dismissReviewQueueRowAction,
    null,
  );
  const busy = approving || dismissing;
  const state = approveState ?? dismissState;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={approve}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={busy} className={`${BUTTON} bg-zinc-900 text-white hover:bg-zinc-800`}>
          Approve
        </button>
      </form>
      <form action={dismiss}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={busy}
          className={`${BUTTON} border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50`}
        >
          Dismiss
        </button>
      </form>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm text-zinc-600" : "text-sm text-red-600"}>
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
