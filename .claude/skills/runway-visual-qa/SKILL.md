# runway-visual-qa

Run a Playwright smoke pass against `runway.startround1.com` to verify a runway-targeted PR's UI behavior post-merge (or against the canary if you've authed cookies there).

Use it whenever a PR touches the runway dashboard's render layer and you want a second pair of eyes (screenshots + DOM assertions) before declaring the deploy verified.

## First-time setup (per machine)

```bash
pnpm install                              # installs @playwright/test
pnpm exec playwright install chromium     # downloads the Chromium binary (~150MB, one-time)
```

The `@playwright/test` devDep does NOT bundle the browser binary — `pnpm install` alone is not enough. Skipping the second step causes `chromium not found` on first `pnpm runway:smoke` run.

## When to use

- Post-merge smoke for a runway PR (the usual case)
- Pre-merge sanity on a canary URL when the change spans many view tiers
- Regression check after a Vercel rollback or recovery

## When NOT to use

- For green-field feature work that isn't deployed yet — `pnpm test:run` (Vitest + happy-dom) is the unit/integration layer
- For visual diff regression — this skill captures screenshots for human review; pixel-diffing is out of scope (file a follow-up issue if needed)

## Prerequisites

- Node + pnpm installed (already present on this machine)
- Chromium browser binary downloaded by Playwright (`pnpm exec playwright install chromium`)
- `PLAYWRIGHT_RUNWAY_PASSWORD` set as an env var. Put it in `.env.local` (gitignored) on the worktree you're running from, or `export PLAYWRIGHT_RUNWAY_PASSWORD=...` in your shell. **Never commit the password.**

## How auth works

The runway dashboard sits behind a single shared-password gate at `/runway/auth?returnTo=<path>` (WorkOS middleware is in the code but inactive in production — verified 2026-05-22 via curl trace that returns exactly 1 redirect, no WorkOS hop).

`tests/runway/auth.setup.ts` POSTs the password via the form, captures the signed `runway_auth` cookie, and saves the full storageState to `playwright/.auth/runway.json`. Every subsequent spec loads that state so we don't re-auth per test.

If WorkOS is ever re-enabled on the production deployment, this setup will need a second leg (WorkOS magic link or saved WorkOS session cookies) — surface it as a fresh issue, don't patch over it.

## Running

From any worktree (the skill ships on `runway` per DECISIONS.md D-04):

```bash
# One-time per shell session
export PLAYWRIGHT_RUNWAY_PASSWORD='<paste-from-1password>'

# Run all specs
pnpm runway:smoke

# Run a specific PR's smoke
pnpm runway:smoke pr-104

# Headed (watch it click through)
pnpm runway:smoke --headed

# Open the HTML report after a run
pnpm exec playwright show-report
```

## Where things land

- `tests/runway/*.spec.ts` — per-PR or per-feature specs
- `tests/runway/auth.setup.ts` — shared auth bootstrap
- `playwright/.auth/runway.json` — cached storage state (gitignored)
- `playwright-report/` — HTML report + screenshots (gitignored)
- `test-results/` — raw trace + video artifacts (gitignored)

## Writing a new spec

1. Copy `tests/runway/pr-104-smoke.spec.ts` to `tests/runway/<feature-or-pr>.spec.ts`
2. Update the `test.describe` block + screenshot output paths
3. Write one `test()` per issue or assertion cluster
4. Capture screenshots with `await page.screenshot({ path: ..., fullPage: true })` at each verification point
5. Use DOM assertions (`toBeVisible`, `toHaveCount(0)`, `toHaveAttribute`) where the state is stable; screenshots cover everything else

## What this skill explicitly does NOT do

- Does not run unit/component tests (use `pnpm test:run`)
- Does not deploy or build the app
- Does not write to prod data — assertions and tab navigation only; **never click toggles, edit forms, or other write paths** in a spec
- Does not run on every Vercel build — Playwright is a devDep; Tim's CI installs it but never invokes `pnpm runway:smoke`. Local operator-driven only.

## Failure modes

| Symptom | Remediation |
|---|---|
| `PLAYWRIGHT_RUNWAY_PASSWORD env var is required` | Set it in `.env.local` or `export` in shell |
| Auth setup fails at `waitForURL` | Password wrong, or the auth form's selectors changed. Run headed (`--headed`) to watch it. |
| `chromium not found` | Run `pnpm exec playwright install chromium` |
| Spec passes but screenshot looks broken | DOM assertions can't catch CSS. Capture the screenshot, report visually, file a regression issue. |
| Production redirects to WorkOS login | WorkOS was re-enabled. Auth setup needs a second leg — escalate, don't patch. |
