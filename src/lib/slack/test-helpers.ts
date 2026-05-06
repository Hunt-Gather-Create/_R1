/**
 * Shared test utilities for Slack-related tests.
 *
 * Used by:
 *   - verify.test.ts (HMAC signature checks)
 *   - events/route.test.ts (request construction)
 *   - Wave 0c onward — `loadFixture` / `mutateFixture` for sanitized real-shape
 *     Slack payload fixtures stored under `tests/fixtures/slack/`.
 */

import { createHmac } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

export function makeSlackSignature(
  secret: string,
  timestamp: string,
  body: string
): string {
  const baseString = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(baseString).digest("hex");
}

export function nowTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

/**
 * Resolve the absolute path to a fixture file under `tests/fixtures/slack/`.
 *
 * `name` may be supplied with or without the `.json` extension.
 */
function fixturePath(name: string): string {
  const file = name.endsWith(".json") ? name : `${name}.json`;
  // From `<repo>/src/lib/slack/test-helpers.ts`, fixtures live at
  // `<repo>/tests/fixtures/slack/`. Resolve via `__dirname` so this works
  // under Vitest regardless of CWD.
  return join(__dirname, "..", "..", "..", "tests", "fixtures", "slack", file);
}

/**
 * Read a sanitized Slack payload fixture from `tests/fixtures/slack/`.
 *
 * The generic `T` lets callers pin the expected shape. The function only
 * parses + returns — schema validation is the caller's responsibility.
 *
 * Throws if the file does not exist or is not valid JSON.
 */
export function loadFixture<T = unknown>(name: string): T {
  const raw = readFileSync(fixturePath(name), "utf-8");
  return JSON.parse(raw) as T;
}

/**
 * Internal type guard: a non-array, non-null object.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `overrides` into a copy of `base` and return the copy.
 *
 * Semantics:
 *   - Plain objects are merged recursively.
 *   - Arrays are replaced wholesale (no element-wise merge).
 *   - Primitives in `overrides` win over `base`.
 *   - The original `base` is never mutated.
 *
 * Typical use:
 *   const fx = loadFixture<ViewSubmission>("view-submission-task");
 *   const stale = mutateFixture(fx, { view: { private_metadata: "..." } });
 */
export function mutateFixture<T>(base: T, overrides: Partial<T>): T {
  return deepMerge(base, overrides) as T;
}

function deepMerge(base: unknown, overrides: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(overrides)) {
    // Non-object override (or non-object base) → override wins.
    return overrides === undefined ? base : overrides;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (k in out && isPlainObject(out[k]) && isPlainObject(v)) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
