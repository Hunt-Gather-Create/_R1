# Infra Bundle B — resilience + auth hardening

Four infra fixes shipped together: they touch adjacent boundaries (Inngest
retry semantics, request-scoped state on Fluid Compute, unauthenticated
API surface) and are cheap to review as one unit. No shared code between
them; each commit lands in isolation.

Fixes: jasonburks23/_R1#2, jasonburks23/_R1#35, jasonburks23/_R1#44, jasonburks23/_R1#52.

---

## Constraints inherited from PROTOCOL

- Cookie-based auth on `/runway/*` pages; separate contracts on `/api/*`
  (Slack signing, MCP bearer, HMAC share tokens). Do NOT extend page cookie
  auth onto arbitrary API routes. This shapes #52's approach.
- `AsyncLocalStorage` is the established pattern for request-scoped state
  in this codebase (`src/lib/runway/runway-als.ts`, retired the
  module-level `_currentBatchId` in issue #17). This shapes #44's approach.
- Node 24 LTS + Fluid Compute — a single Node process serves many
  concurrent requests. Module-level `let` variables bleed across requests.
  Both #44 and (historically) #17 exist because of this.

---

## #2 — Inngest job tracker must not cascade its own failures

**File:** `src/lib/inngest/functions/job-tracker.ts`

Three tracker functions (`trackFunctionInvoked`, `trackFunctionFinished`,
`trackFunctionFailed`) each do a single `db.insert` / `db.update` against
`backgroundJobs`. `retries: 0` is already set on each. Today, if the DB
write throws, the tracker function errors, Inngest records that error,
and the outer function whose lifecycle we were tracking is left with a
misleading failure trail even though the underlying work succeeded.

**Change:** wrap the DB call in `try/catch`, log a structured warning via
`console.warn(JSON.stringify({ event: "job_tracker_write_failed", ... }))`,
return a `{ skipped: true, reason: "db_write_failed" }` result. Tracker
failures become observable in logs but never surface as function errors.

**Test:** mock the `db` module to throw once per tracker, assert warning is
logged and the returned shape includes the skipped reason.

---

## #52 — `/api/runway/version` requires auth

**Files:**
- `src/app/api/runway/version/route.ts` — add `getCurrentUser()` gate
- `src/app/api/runway/version/route.test.ts` — new file

### Current state (verified 2026-07-16)

Prod curl `/api/runway/version` unauthenticated: `HTTP/2 200`. The route
sits in the `/((?!_next/static|_next/image|favicon.ico|public/).*)`
matcher and is NOT in `unauthenticatedPaths`, so `proxy.ts` SHOULD gate
it. In practice the WorkOS authkit middleware appears to let JSON
`/api/*` routes through — redirecting only on `Accept: text/html`. The
route's header comment claims auth is enforced by `proxy.ts`; that comment
is aspirational and wrong.

The single consumer (`src/app/runway/use-version-poll.ts:105`) already
sends `credentials: "same-origin"`, so the WorkOS session cookie is
already on the wire. Zero client change needed.

### Options considered (from original DECISION-Q, 2026-06-16)

| Option | Verdict |
|---|---|
| A: `X-Runway-Token` header check | Rejected — client JS cannot carry a server secret. |
| B: Bearer token in the polling fetch | Rejected — same client-secret problem. |
| C: Delete the route | Rejected — breaks the deploy-detection refresh. |
| **D: server-side `getCurrentUser()` check in the route** | **Chosen.** |
| D2: also broaden `proxy.ts` to gate JSON `/api/*` uniformly | Deferred — separate GH issue, out of bundle B scope. |
| E: close #52 as materially reduced | Rejected — remaining endpoint-existence leak still warrants a fix. |

### Change

```ts
import { getCurrentUser } from "@/lib/auth";
// ...
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const db = getRunwayDb();
  // ...existing DB read + response shape...
}
```

Plus: rewrite the route's leading header comment to describe the actual
enforcement path (route-local `getCurrentUser()`, not `proxy.ts`).

### Stale leak framing (for PR body)

The issue as originally filed described a `{sha, builtAt}` leak. The
route currently returns only `{ version: <ISO timestamp> }` — the
deploy-metadata portion of the leak was defanged in an earlier change.
What remains is endpoint-existence + auth-bypass, still worth closing.

### Systemic follow-up (out of scope)

The larger question — why does `authkitMiddleware` let JSON `/api/*`
routes through despite the matcher configuration — is a separate concern
touching the auth boundary itself. Filing as a NEW GH issue at PR-open
time so option D2 has a home.

### Test

`src/app/api/runway/version/route.test.ts` — mock `getCurrentUser`:
- returns `null` → route returns 401
- returns a user → route returns 200 with `{ version }`

---

## #44 — `_cachedClients` request-scoping via sibling-file ALS

**Files:**
- `src/lib/runway/clients-cache-als.ts` — new file, sibling to `runway-als.ts`
- `src/lib/runway/operations-utils.ts` — remove module-level `_cachedClients`, read/write ALS instead
- Callers wrapped: `src/app/runway/queries.ts`, `src/lib/inngest/functions/slack-modal-submit.ts`,
  `src/app/api/slack/options/route.ts`, `src/app/api/slack/interactivity/route.ts`,
  `src/lib/runway/operations-reads-week.ts` (internal hot path)
- Test: `src/lib/runway/clients-cache-als.test.ts` — new file, mirrors `runway-als.test.ts`
  load-bearing test ("concurrent scopes do not bleed").

### Problem

`operations-utils.ts:142-158` holds a module-level `let _cachedClients`
with a 5-second TTL. On Fluid Compute this is the same bug as #17: the
cache is scoped to the Node instance, not the request. Two concurrent
requests hitting the same handler share the same `_cachedClients` slot;
if request A invalidates it, request B sees the invalidation. If a
client mutation lands during request A's window, request B may read
stale rows for up to 5 seconds.

### Design

Follows the `runway-als.ts` shape exactly:

```ts
// src/lib/runway/clients-cache-als.ts
import { AsyncLocalStorage } from "node:async_hooks";

type Store = { clients: ClientRow[] | null };
const als = new AsyncLocalStorage<Store>();

export function withClientsCache<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ clients: null }, fn);
}
export function getRequestClientsCache(): ClientRow[] | null { /* ... */ }
export function setRequestClientsCache(clients: ClientRow[]): void { /* ... */ }
export function invalidateRequestClientsCache(): void { /* ... */ }
```

`operations-utils.ts` `getCachedClients()` becomes:

```ts
async function getCachedClients(): Promise<ClientRow[]> {
  const cached = getRequestClientsCache();
  if (cached) return cached;
  const rows = await withRunwayRetry(/* ... */);
  setRequestClientsCache(rows);
  return rows;
}
```

If a caller is INSIDE `withClientsCache(fn)`, the cache is per-request-chain
(no bleed). If a caller is OUTSIDE any scope, `getRequestClientsCache()`
returns `null` and every call round-trips the DB. That's the correct
behavior for the callers we're not wrapping — the "cache hit" they were
getting under module-level state was the bug, not the feature.

`invalidateClientCache()` (public helper, called from tests + after
`createClient`) delegates to `invalidateRequestClientsCache()`. Outside
any scope it becomes a safe no-op.

### Wrap sites

High-fanout entry points get wrapped in `withClientsCache(async () => ...)`:

- `src/app/runway/queries.ts` — 3 `getClientNameMap` calls across page queries
- `src/lib/inngest/functions/slack-modal-submit.ts` — 2 `getAllClients` calls in the handler body
- `src/app/api/slack/options/route.ts` — hot autocomplete path
- `src/app/api/slack/interactivity/route.ts` — POST handler wraps its body
- `src/lib/runway/operations-reads-week.ts` — the multi-`getClientBySlug` functions

Single-shot callers (one `getClientBySlug` inside a helper that already runs
inside a wrapped scope) get the benefit for free through async context.

### What we are NOT doing

- Not extending `runway-als.ts` with a second store. Batch id and client
  cache are unrelated concerns; sibling files keep them separable.
- Not wrapping every single call site — the point of ALS is that async
  context carries down. Wrap the top of the call tree; leaves get it
  automatically.

---

## #35 — Runway Slack message: idempotency at the function boundary

**File:** `src/lib/inngest/functions/runway-slack-message.ts` + test.

### Problem

Today the function has `retries: 2` and no idempotency key. If the same
Slack event is dispatched twice (webhook retry, transient network) or the
function is retried after a partial success, the AI pipeline runs again
and `handleDirectMessage` posts a second `chat.postMessage` — the user
sees a duplicate reply.

### Change

Add function-level `idempotency: "event.data.messageTs"`. `messageTs` is
Slack's unique per-message timestamp, so two events for the same user
message share the same key. Inngest dedupes at the queue layer: a second
invocation with the same `event.data.messageTs` becomes a no-op run.

```ts
export const processRunwaySlackMessage = inngest.createFunction(
  {
    id: "runway-slack-message",
    name: "Runway Slack Message",
    retries: 2,
    concurrency: { limit: 3 },
    idempotency: "event.data.messageTs",
  },
  // ...
);
```

This is the load-bearing fix: retry-driven duplicate posts are prevented
at the queue rather than inside the function. Concurrency limit is
unchanged (`3` per key still allows parallel messages from different
users).

### Test

Extend `runway-slack-message.test.ts` to assert the idempotency config
value. Full retry-dedup behavior is enforced by Inngest infra and not
practical to simulate in-test; the config assertion + the `messageTs`
threading are what we can verify.

### Scope note — "split Slack send into own step"

The original issue suggested also splitting the AI-processing step from
the Slack-send step so a Slack-post retry doesn't re-run the AI turn.
This would require refactoring `handleDirectMessage` (200+ lines,
tightly couples AI orchestration with `slack.chat.postMessage`) to
return a response payload and have the caller step post to Slack. That
is a substantially larger change with its own review surface.

Function-level idempotency prevents the observed failure mode
(duplicate replies from retries) at the queue layer, which is the
higher-order fix. The step-split is a distinct optimization worth its
own issue — deferred, not silently dropped.

---

## Rollout / ordering

Commits land in dependency order (each is independently safe to revert):

1. This plan doc.
2. #2 — smallest, no runtime coupling.
3. #52 — auth boundary tightening; independent test file.
4. #44 — largest surface (new file + 5 wrap sites + call-site refactor in `operations-utils.ts`).
5. #35 — one config-line change + test.

Full QA chain (`/code-review` + QA subagent + `/preflight` build + tests + lint + `/pr-ready`)
runs after commit 5 on the full diff, then `BUILD READY FOR TP GATE`.

No prod-data writes in this bundle. No `data-integrity-tp` skill involvement.
