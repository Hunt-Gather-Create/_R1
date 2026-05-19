"use client";

import { useActionState } from "react";

import {
  verifyAndSetRunwayAuth,
  type RunwayAuthState,
} from "./actions";

type Props = {
  returnTo: string;
};

export default function AuthForm({ returnTo }: Props) {
  const [state, formAction, pending] = useActionState<RunwayAuthState, FormData>(
    verifyAndSetRunwayAuth,
    null,
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <form
        action={formAction}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-lg font-semibold text-zinc-900">Runway</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Enter the shared password to continue.
          </p>
        </div>
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="block">
          <span className="sr-only">Password</span>
          <input
            type="password"
            name="password"
            autoFocus
            autoComplete="current-password"
            required
            disabled={pending}
            aria-invalid={state?.error ? true : undefined}
            className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-100"
          />
        </label>
        {state?.error ? (
          <p
            role="alert"
            className="text-sm text-red-600"
          >
            {state.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-500"
        >
          {pending ? "Verifying…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
