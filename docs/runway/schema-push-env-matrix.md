# Runway schema push — environment matrix + verification runbook

`scripts/runway-schema-push.mjs` decides on every Vercel build whether to push
the Runway schema to the live Turso DB (`shouldRunSchemaPush`). This doc is the
decision table for every realistic deploy shape, plus the manual runbook for
verifying the gate on a live deploy.

Context: RW-INC-2026-07-27-01. Hunt-Gather-Create's Vercel treats the `runway`
branch as a **preview** deploy, but the live Runway app is aliased to those
deploys. The original production-only gate (PR #116) therefore skipped the
schema push on the deploys that actually serve prod, and PR #118 shipped code
querying four tables prod never got. The `VERCEL_GIT_COMMIT_REF === "runway"`
trigger closes that gap.

## Decision precedence

`SKIP_DB_MIGRATIONS` > missing `RUNWAY_DATABASE_URL` > `RUN_DB_MIGRATIONS` >
`VERCEL_ENV=production` > (`VERCEL_GIT_COMMIT_REF=runway` AND
`VERCEL_GIT_PULL_REQUEST_ID` empty AND `VERCEL_DEPLOYMENT_ID` non-empty) >
default skip.

SKIP stays above everything and the force flag stays above the env checks so
operators keep both manual overrides.

The runway trigger requires all three conditions:

- **Exact ref match** — feature branches and substring lookalikes never fire.
- **Empty PR id** — `VERCEL_GIT_COMMIT_REF` is the HEAD branch name, so a
  fork PR whose branch happens to be named `runway` (an accidental fork-sync
  PR is the realistic shape) would match on ref alone and force-push prod
  schema from unmerged code. The deploy that actually serves prod is the
  push-triggered branch deploy of upstream `runway`, and Vercel gives that
  deploy an empty `VERCEL_GIT_PULL_REQUEST_ID`; every PR-triggered preview
  (including all fork PRs) carries the PR's id.
- **Non-empty `VERCEL_DEPLOYMENT_ID` (cloud-deploy marker)** — a local
  `vercel dev` / `vercel build` on the runway branch can populate the ref
  while the checkout is DIRTY. A developer mid-migration has work-in-progress
  schema, and `drizzle-kit push --force` of WIP schema can emit DROPs at prod
  (`RUNWAY_DATABASE_URL` is All-Environments, so it gets pulled locally).
  "The push is idempotent" only holds for a pristine checkout, so local
  builds never push. Vercel populates `VERCEL_DEPLOYMENT_ID` only in cloud
  builds. The deliberate local escape is `RUN_DB_MIGRATIONS=true`, which sits
  above this trigger.

## Environment matrix

| Deploy shape | Typical env vars | Decision | Why | Blast radius if this were wrong |
|---|---|---|---|---|
| Production deploy (main branch on a Vercel prod target) | `VERCEL_ENV=production`, `VERCEL_GIT_COMMIT_REF=main`, URL set | **PUSH** | Production serves the prod DB; schema must match shipped code. | Wrong-skip: prod code queries tables that don't exist → 500s (the incident shape). |
| Runway-branch deploy on Hunt-Gather-Create | `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=runway`, `VERCEL_GIT_PULL_REQUEST_ID=""`, `VERCEL_DEPLOYMENT_ID=dpl_…`, URL set | **PUSH** | Vercel classifies it preview, but the live Runway app is aliased to it. This is the RW-INC-2026-07-27-01 gap. | Wrong-skip: exactly RW-INC-2026-07-27-01 — dashboard 500 on first schema-adding PR. |
| Runway-branch cloud deploy, `VERCEL_ENV` missing | `VERCEL_GIT_COMMIT_REF=runway`, no PR id, `VERCEL_DEPLOYMENT_ID` set, URL set | **PUSH** | Trigger is `VERCEL_ENV`-agnostic on purpose; branch identity plus the cloud marker is the signal. | Wrong-skip: same as above if Vercel ever omits `VERCEL_ENV`. |
| Feature-branch preview | `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=feat/xyz`, URL set | skip | Preview builds must never write prod schema. | Wrong-push: any open branch could rewrite prod schema mid-review (pre-2026-07 behavior PR #116 fixed). |
| Fork PR preview (feature branch) | `VERCEL_ENV=preview`, ref is the fork's branch name, `VERCEL_GIT_PULL_REQUEST_ID` set, URL set (URL is "All Environments") | skip | Ref doesn't equal `runway`, and the PR id blocks it anyway. | Wrong-push: untrusted fork branches force-push prod schema — the exact hole PR #116 closed. |
| Fork PR whose branch is named `runway` | `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=runway`, `VERCEL_GIT_PULL_REQUEST_ID` set | skip + **read-only parity check** | The ref matches but the PR id disqualifies it — PR previews never push. An accidental sync-PR from a fork's `runway` branch is the realistic shape here. The check-only parity run (see caveat below) also fires here; it is read-only and harmless. | Wrong-push: `drizzle-kit push --force` from a stale fork could DROP tables prod code depends on. |
| Local `vercel build` / `vercel dev` on the runway branch | `VERCEL_GIT_COMMIT_REF=runway` possibly populated from local git, `VERCEL_DEPLOYMENT_ID` unset, URL possibly pulled locally | skip | No cloud-deploy marker. The realistic local shape is a DIRTY checkout mid-migration; force-pushing WIP schema can DROP prod columns. Never "safe because idempotent" — idempotence assumes a pristine checkout. | Wrong-push: local WIP schema force-pushed at prod, potential data loss. Escape hatch for intentional local pushes: `RUN_DB_MIGRATIONS=true`. |
| Preview with no ref | `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF` unset | skip | No branch identity → default deny. | Wrong-push: unattributable builds writing prod. |
| Local dev / CI | `VERCEL_ENV` unset, no ref, URL maybe set via `.env.local` | skip | Default deny; use `RUN_DB_MIGRATIONS=true` to force intentionally (dev flow is `pnpm runway:push`). | Wrong-push: every local `pnpm build` would write prod. |
| `vercel dev` on the runway branch | `VERCEL_ENV=development`, `VERCEL_GIT_COMMIT_REF=runway` | **PUSH** (edge) | Trigger is env-agnostic. Shouldn't happen in practice; safe if it does — the push is idempotent (`drizzle-kit push` + `INSERT OR IGNORE` seeds) and the parity check runs after. | Accepted edge: pushes the same schema prod already has. |
| Operator force | `RUN_DB_MIGRATIONS=true`, URL set, any env | **PUSH** | Manual override for incident response (used in the RW-INC-2026-07-27-01 path (b) apply). | — |
| Operator hold | `SKIP_DB_MIGRATIONS=true`, anything else set | skip | Hard off-switch, beats everything including force. | — |
| Missing DB URL | `RUNWAY_DATABASE_URL` unset or blank | skip | Nothing to push to; beats the force flag. | — |

Exact truth table is pinned by `scripts/runway-schema-push.test.ts` — every row
above has an explicit test.

**Known caveat (wrong-skip shape) — detected mechanically:** if a PR is ever
opened FROM the upstream `runway` branch (e.g. a `runway` → `main` PR on
Hunt-Gather-Create), Vercel links the runway-branch deploys to that PR, the
PR id becomes non-empty, and the trigger skips the push. That window is NOT
left to log readers: on exactly this skip branch (`ref=runway` + PR id set),
the build still runs the read-only schema parity check. If the prior deploy
already pushed the schema, the check passes and nothing changes. If the
wrong-skip left drift, the parity check fails the build mechanically —
the deploy never goes live against a mismatched DB. Remediation: set
`RUN_DB_MIGRATIONS=true` on the deploy (or run the push manually per the
incident runbook) and close or retarget the PR.

## Hard dependency: the Vercel dashboard setting

Every `VERCEL_*` variable this gate reads (`VERCEL_ENV`,
`VERCEL_GIT_COMMIT_REF`, `VERCEL_GIT_PULL_REQUEST_ID`,
`VERCEL_DEPLOYMENT_ID`) is exposed to builds ONLY while **"Enable access to
System Environment Variables"** is checked on the Vercel project (Settings →
Environment Variables). If that box is ever unchecked, the gate reads
everything as unset, default-skips every runway deploy, the parity check
never runs, and the incident recurs with this fix merged. No in-build code
can detect the state — `VERCEL=1` itself is in the same gated list.

**Diagnostic, one step, no archaeology:** if a runway-branch deploy's build
log shows a skip with reason containing `ref=unset`, check this setting
FIRST. Verified ON for the Hunt-Gather-Create r1 project as part of PR #120
(operator verification, RW-INC-2026-07-27-01 Holdout finding M4).

## Post-push parity check

After a successful push, `scripts/runway-schema-parity-check.mjs` probes every
expected table (`SELECT 1 ... LIMIT 0`, read-only) plus the `_meta` seed keys.
Any gap exits non-zero → the Vercel build fails → the deploy never aliases
forward against a DB the code can't run against. This closes detection gap 1
from the incident report.

Standalone run against whatever `RUNWAY_DATABASE_URL`/`RUNWAY_AUTH_TOKEN` are
in the environment:

```bash
set -a; source .env.local; set +a
node scripts/runway-schema-parity-check.mjs
```

## Runbook: verify the gate on a live deploy

1. Open the Vercel deployment for the build you're checking (Hunt-Gather-Create
   project → Deployments → pick the deploy).
2. Open **Build Logs** and search for `Runway database schema`.
3. You will see exactly one of:
   - `Pushing Runway database schema (<reason>)...` — the gate decided to push.
     The reason string tells you which trigger fired (`production deploy`,
     `runway-branch cloud deploy (schema-push contract)`, or
     `RUN_DB_MIGRATIONS forces the push`).
   - `Skipping Runway database schema push: <reason>.` — the gate decided to
     skip, with the losing env shape in the reason.
4. On a push, also confirm the follow-up line
   `Runway schema parity check passed: ... tables present, column shape verified ... , _meta seeded ...`.
   A push without a passing parity line means the build failed before
   completion — the deploy should show as errored, not promoted.
5. Cross-check the decision against the matrix above using the deploy's branch
   (shown in the deployment header) and target environment.

If the log shows a skip on a runway-branch deploy, or a push on any fork or
feature-branch preview, the gate has regressed — treat it as an incident and
check `shouldRunSchemaPush` against the truth-table tests.
