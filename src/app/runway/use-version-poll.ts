"use client";

import { useEffect, useRef, useState } from "react";
import type { useRouter } from "next/navigation";

// Cost: poll a cheap endpoint every 15s and only refresh when something
// actually changed, instead of forcing a full RSC re-render every 60s.
const VERSION_POLL_INTERVAL_MS = 15 * 1000;

// Trip the staleness chip after this many consecutive failures.
const STALE_FAILURE_THRESHOLD = 3;

// Auth-style status codes that should trip staleness on the very first
// failure. A 302 typically means the WorkOS auth proxy redirected us to
// the login page; 401 means the session was rejected outright. Either way
// the dashboard has lost its session and only a hard refresh recovers it.
const AUTH_EXPIRY_STATUSES = new Set([302, 401]);

/**
 * Polls /api/runway/version at a fixed cadence and triggers
 * `router.refresh()` when the server-reported version changes.
 *
 * Pauses while the tab is hidden. On return-to-visible: fires one
 * immediate fetch and starts a fresh interval (no double-fire from a
 * leftover pre-pause timer).
 *
 * Returns `{ isStale: true }` once the loop has given up — either after
 * 3 consecutive failures or a single auth-expiry response (302/401).
 * Once stale, polling does NOT resume on visibility change. The user
 * must hard-refresh to recover.
 */
export function useVersionPoll(router: ReturnType<typeof useRouter>): { isStale: boolean } {
  const [isStale, setIsStale] = useState(false);

  // Hold the router in a ref so the effect doesn't re-run if the router
  // identity changes. The router is stable in production (Next provides
  // a memoized reference) but not in test mocks, and re-running the
  // effect would fire a wasted mount-time fetch on every state change.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let baseline: string | null | undefined = undefined; // undefined = not yet seeded
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    let stale = false;
    // Tracks the in-flight fetch's AbortController so we can abort a
    // hung request before starting a new one. Prevents connection-pool
    // exhaustion when the server is slow or unresponsive. The `cancelled`
    // closure flag is still needed: it guards against state writes from
    // a fetch that resolved BEFORE unmount but is mid-await when the
    // component tears down.
    let controller: AbortController | null = null;

    // Refs-as-locals: these counters live for the lifetime of the effect
    // and don't need to trigger re-renders when they tick.
    const failureCount = { current: 0 };
    const loggedError = { current: false };

    const isAbortError = (err: unknown): boolean =>
      err instanceof DOMException && err.name === "AbortError";

    const stopInterval = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const tripStale = () => {
      if (stale) return;
      stale = true;
      stopInterval();
      // Defer state update so we don't trigger a re-render mid-fetch
      // resolution. setState during a microtask is fine in React 19.
      setIsStale(true);
    };

    const handleFailure = (logArgs: unknown[], status?: number) => {
      failureCount.current += 1;
      if (!loggedError.current) {
        console.error(...logArgs);
        loggedError.current = true;
      }
      const authExpiry = status !== undefined && AUTH_EXPIRY_STATUSES.has(status);
      if (authExpiry || failureCount.current >= STALE_FAILURE_THRESHOLD) {
        tripStale();
      }
    };

    const check = async () => {
      if (stale || cancelled) return;
      // Abort the previous in-flight request (if any) before starting a
      // new one. Without this, a hung request could pile up alongside
      // each new tick and exhaust the browser's per-origin connection
      // pool.
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;

      let res: Response;
      try {
        res = await fetch("/api/runway/version", {
          credentials: "same-origin",
          signal,
        });
      } catch (err) {
        if (cancelled) return;
        // AbortError from our own controller.abort() is benign — we
        // either unmounted or superseded this request with a newer one.
        if (isAbortError(err)) return;
        handleFailure(["[runway] version poll failed", err]);
        return;
      }
      if (cancelled) return;
      if (!res.ok) {
        handleFailure(
          [`[runway] version poll non-OK response: ${res.status}`],
          res.status
        );
        return;
      }
      let body: { version: string | null };
      try {
        body = (await res.json()) as { version: string | null };
      } catch (err) {
        if (cancelled) return;
        // A partial/aborted response can throw from .json() too.
        if (isAbortError(err)) return;
        handleFailure(["[runway] version poll failed", err]);
        return;
      }
      if (cancelled) return;
      // Successful parse — reset failure tracking.
      failureCount.current = 0;
      loggedError.current = false;
      const next = body.version ?? null;
      if (baseline === undefined) {
        // First successful response — seed without refreshing.
        baseline = next;
        return;
      }
      if (next !== baseline) {
        baseline = next;
        routerRef.current.refresh();
      }
    };

    const startInterval = () => {
      if (stale) return;
      if (intervalId !== null) clearInterval(intervalId);
      intervalId = setInterval(check, VERSION_POLL_INTERVAL_MS);
    };

    const onVisibilityChange = () => {
      if (stale) return;
      if (document.visibilityState === "hidden") {
        stopInterval();
      } else {
        // Returning to visible: fire one immediate check, then start a
        // fresh interval so we don't double-fire on the next 15s tick.
        stopInterval();
        void check();
        startInterval();
      }
    };

    // Item 7 fix: only fire the mount-time fetch when the tab is actually
    // visible. A tab launched in the background should sit idle until the
    // user looks at it, otherwise we burn a request on a viewer who may
    // never see the page.
    if (document.visibilityState !== "hidden") {
      void check();
      startInterval();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      controller?.abort();
      stopInterval();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // routerRef is intentionally not a dep — see comment above.
  }, []);

  return { isStale };
}

// Test-only export so the test file can keep using the same constant
// (kept un-imported in production code to avoid bundling churn).
export { VERSION_POLL_INTERVAL_MS };
