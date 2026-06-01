"use client";

/**
 * #70 — cookie-stored `updatedBy` name for the dashboard edit modal.
 *
 * The first time the operator opens the edit modal in a session, the
 * pencil orchestrator prompts for a name; the name persists in a cookie
 * so subsequent edits in the same browser auto-use it. Audit rows from
 * the dashboard then carry `source='dashboard'` + `updatedBy=<that name>`
 * so reviewers can tell who made each change.
 *
 * Plain string-valued cookie under `runway_editor_name`. Path = "/" so
 * it's visible across the runway routes. Max-Age = 30 days — long enough
 * to avoid daily re-prompting, short enough that an old shared kiosk
 * eventually forgets a stale name.
 */

import { useCallback, useState } from "react";

const COOKIE_NAME = "runway_editor_name";
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

export function useEditorName(): {
  name: string | null;
  setName: (next: string) => void;
} {
  // Lazy initializer so the cookie is read once on first render (client
  // only). SSR sees `null` since document is undefined; first client paint
  // resolves the actual value without a setState-in-effect cascade. Hydration
  // mismatch is avoided because the pencil button render doesn't depend on
  // the name — only the conditional modal phase does, and that's a
  // user-interaction-gated state change.
  const [name, setNameState] = useState<string | null>(() =>
    readCookie(COOKIE_NAME),
  );

  const setName = useCallback((next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    writeCookie(COOKIE_NAME, trimmed, COOKIE_MAX_AGE_S);
    setNameState(trimmed);
  }, []);

  return { name, setName };
}

function readCookie(key: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const pair of cookies) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (decodeURIComponent(pair.slice(0, eq)) === key) {
      return decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return null;
}

function writeCookie(key: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;
  const encoded =
    `${encodeURIComponent(key)}=${encodeURIComponent(value)}` +
    `; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`;
  document.cookie = encoded;
}
