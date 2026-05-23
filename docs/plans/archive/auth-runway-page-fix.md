# Auth: gate /runway page (issue #13)

**Created:** 2026-05-15
**Pivoted:** 2026-05-18 — see "What we learned" below
**Branch:** `fix/13-runway-password-gate` (off `upstream/runway`)
**GitHub issue:** https://github.com/jasonburks23/_R1/issues/13
**Follow-ups filed pre-code:** #59 (rate limiting), #60 (sub-path returnTo)

---

## TL;DR

`https://runway.startround1.com/runway` returns HTTP 200 to unauthenticated requests. Public exposure of client-named project state, deadlines, personnel, and Q/A.

Fix shipped: a shared-password gate scoped to `/runway`, completely independent of WorkOS. HMAC-signed `httpOnly` cookie, 30-day TTL, route group so the auth page itself isn't gated. No dependency changes. `/w/[slug]` continues to use WorkOS untouched.

## Approach

Two new env vars (set on Vercel before merge):

- `RUNWAY_PASSWORD` — the shared password operators type into the form. Rotating this does NOT invalidate existing cookies.
- `RUNWAY_AUTH_SECRET` — HMAC-SHA256 secret signing the cookie. Generate with `openssl rand -hex 32`. Rotating this DOES invalidate all existing sessions.

Cookie shape: `<expiresAtMs>.<base64url(hmac)>`. Options: `httpOnly`, `secure` (prod), `sameSite=lax`, `path=/runway`, 30-day `maxAge`. Server-side verifier also enforces `now < expiresAtMs` so the browser can't extend the cookie past its signed expiry.

Route layout (route group `(gated)` avoids the auth-page redirect loop):

```
src/app/runway/
  (gated)/
    layout.tsx          # NEW — checks cookie, redirects to /runway/auth on null/invalid
    layout.test.tsx
    page.tsx            # MOVED from src/app/runway/page.tsx — relative imports updated to ../X
    page.test.tsx       # MOVED — vi.mock paths updated to ../X
  auth/
    page.tsx            # NEW — server component; if cookie valid, redirects to returnTo
    page.test.tsx
    auth-form.tsx       # NEW — client component, useActionState
    actions.ts          # NEW — verifyAndSetRunwayAuth server action
    actions.test.ts
  [all other files unchanged]

src/lib/runway/
  auth-cookie.ts        # NEW — sign/verify/safeReturnTo/password helpers, missing-env throws
  auth-cookie.test.ts
```

Three guards stack in a defense-in-depth chain (none of them is sufficient alone):

1. The `(gated)` layout — server-side cookie check on every `/runway/**` request that isn't `/runway/auth`.
2. The constant-time password compare in `verifyRunwayPassword` — uses `crypto.createHash + timingSafeEqual` on 32-byte SHA-256 digests, not raw-string compare.
3. The 500ms wrong-password delay — bounds brute-force submissions from a single client to ~2/sec. Proper rate limiting tracked at issue #59.

## What we learned from the WorkOS attempt (abandoned 2026-05-15)

The first pass at #13 tried to gate `/runway` through WorkOS — bump `@workos-inc/authkit-nextjs` v2.13 → v4.0.1, relocate `proxy.ts` to `src/proxy.ts`, add a WorkOS-backed runway layout guard. That branch (`feature/auth-runway-page-fix`, 5 commits `d2a93a0…ddd0a7a` on the jasonburks23 fork) deployed canary green but was scrapped per Tim 5/15: WorkOS is overkill for a single internal page.

Two diagnostic findings are worth preserving regardless:

- **Root-level `proxy.ts` is silently ignored when the codebase uses the `src/` convention for `app/`.** The original `proxy.ts` at the repo root was dead code — Next.js 16 looks at `src/proxy.ts`. Other pages (`/`, `/dashboard`, `/projects`) survived because each had per-page guards; `/runway` had none.
- **`@workos-inc/authkit-nextjs` v2.13 predates Next.js 16's proxy contract.** v2.13 only exports `authkitMiddleware`; v4 introduced the `authkitProxy` default-export form that Next.js 16's proxy.ts loader needs. Anything that wants to use WorkOS in a Next.js 16 codebase needs the v4 bump.

These are still true. If we ever want WorkOS to gate `/runway` (e.g., once the team is large enough to warrant individual accounts and audit trails), the path forward is:

1. Bump authkit-nextjs to v4.
2. Move proxy.ts to `src/proxy.ts`.
3. Exclude `/api` from the proxy matcher so route handlers (Slack, MCP, Inngest, cron, gantt-share HMAC) keep self-authenticating.
4. Add a WorkOS-backed layout guard inside `(gated)/`, replacing the cookie-based one.

That migration is out of scope for #13 today.

## Acceptance

- [x] Cookie sign/verify round-trips; tampering and expiry both reject.
- [x] `verifyRunwayPassword` is constant-time via SHA-256 hash + `timingSafeEqual` on 32-byte digests.
- [x] Missing `RUNWAY_AUTH_SECRET` / `RUNWAY_PASSWORD` throws an operator-facing error.
- [x] Wrong-password attempts wait 500ms before returning the error.
- [x] `/runway/auth` is reachable while unauthenticated (route group keeps it outside the gate).
- [x] Already-authed users hitting `/runway/auth` redirect through to returnTo.
- [x] returnTo is sanitized: only `/runway` (and `/runway/*` sub-paths that aren't `/runway/auth`) are honored.
- [x] All `.env.example` keys documented with rotation semantics.
- [x] `/w/[slug]` workspace pages remain WorkOS-gated (untouched).
- [ ] **Operator pre-merge:** `RUNWAY_PASSWORD` and `RUNWAY_AUTH_SECRET` set on the Vercel project (prod + preview).

## Out of scope

- WorkOS changes (`/w/[slug]`, `src/lib/auth.ts`, `proxy.ts`, authkit-nextjs version).
- `/api/runway/version` 200-unauth gap — separate follow-up.
- Slack/MCP/Inngest auth — separately gated.
- Proper rate limiting on `/runway/auth` — tracked at #59.
- Sub-path returnTo fidelity — tracked at #60.
- Multi-user accounts (this is a shared password by design).
- Workspace-role-based view filtering inside `/runway`.

## Verification

```bash
# Unit + integration tests
pnpm test:run

# Type check
pnpm exec tsc --noEmit

# Build
pnpm build

# Lint
pnpm lint
```

Manual local round trip (incognito, `pnpm dev`):

1. Visit `http://localhost:3000/runway` → expect redirect to `/runway/auth?returnTo=/runway`.
2. Wrong password → form shows error, ~500ms perceived delay, no cookie set in DevTools.
3. Right password → redirected to `/runway`, page renders, cookie present with `path=/runway`, `httpOnly`, `sameSite=lax`.
4. Reload `/runway` → renders directly (cookie valid).
5. Visit `/runway/auth` while authed → bounces through to `/runway`.
6. Clear cookie → `/runway` redirects to auth again.
7. Tamper with cookie value → redirect to auth (verifier rejects).

Canary smoke (curl, no cookies):

```bash
curl -I https://<canary>/runway              # expect 307/302 to /runway/auth?returnTo=/runway
curl -I https://<canary>/runway/auth         # expect 200 (form renders)
curl -I https://<canary>/api/runway/version  # status quo (separate follow-up)
```

## Operator preferences honored

- Tests woven into each build step, not appended.
- No AI voice in code or copy.
- Thorough PR description (why, deployment notes, root causes, verification).
- QA-discovered issues fixed in this PR.
- Atomic commits via `/atomic-commits`.
- Operator opens the PR (do NOT auto-push).
