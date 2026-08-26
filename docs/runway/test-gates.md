# Test gates: which one is a gate, and which one is not

There are two. They do different jobs and **neither substitutes for the other.**

| | what it is | where it runs | can it be skipped? |
|---|---|---|---|
| `scripts/hooks/pre-push` | a convenience | your machine | yes, trivially |
| `.github/workflows/pr-tests.yml` | **the gate** | the pull request | no |

## The local hook is not a gate

`scripts/hooks/pre-push` runs the suite before a push and refuses a red one.

**It lives in `.git` config, it is not cloned, `--no-verify` walks straight past it, and it protects only machines that ran the installer.** It is also per-working-tree, so a fresh `git worktree` starts without it.

It catches the honest mistake cheaply. **It does not remove ambiguity.** It would not have caught the PR #128 breakage if the pusher had skipped it.

Install it once per clone and once per worktree:

```bash
sh scripts/hooks/install.sh
```

Skip it deliberately when you mean to:

```bash
git push --no-verify        # one-off
RUNWAY_SKIP_PREPUSH=1       # session-wide
```

Both escape hatches are on purpose. A control you cannot bypass gets ripped out; one you bypass loudly stays.

## The PR check is the gate

`.github/workflows/pr-tests.yml`. One job, one command, on every pull request.

### Why it exists (_R1#107)

Before it, the only check-run on a PR was `Vercel Preview Comments`, which reports **failure** on every cross-fork PR for authorization reasons unrelated to the code.

So from the PR page:

| actual state of the suite | what the reviewer saw |
|---|---|
| green | red check |
| red | red check |
| never ran | red check |

**That is worse than having no check. A missing gate makes you go look. An uninformative one tells you not to bother.**

On 2026-08-26 that cost us: PR #128 merged and turned `upstream/runway` red, and nothing surfaced it. It was found by hand, hours later, by checking out the tip of upstream in a detached worktree and running the suite there.

The value of the check is not that the tests run. **It is that the PR page finally shows three different pictures for three different states.**

### Do not grow this file

No matrix. No OS spread. No node-version spread. No build, no lint, no `tsc`.

The fleet burned 3,000 GitHub Actions minutes in one day on over-engineered pipelines. This shape is the one that does not become that. **Anything beyond one job and one command is a new decision, not an edit.**

Specifically excluded, with reasons:

- **`pnpm build`** — its first step connects to a **live Turso database**, and its second connects to a different one. It is safe only behind `SKIP_DB_MIGRATIONS=1`, which turns it into a compile check rather than a build check. That belongs in a deliberate step, not an automatic one. See `scripts/runway-schema-push.mjs`.
- **`tsc --noEmit`** — reports roughly 210 errors today, all in test files, which `next build` never reaches. Gating on an unmeasured backlog just gets the gate switched off. Tracked as _R1#107 task 2, behind establishing a baseline.
- **lint** — warnings only today. Noise without signal.

### Why `pull_request` and not `pull_request_target`

Our PRs come from a fork. `pull_request_target` runs fork code with access to repository secrets. This job needs no secrets, because the suite never touches a live database, and it should stay that way.

## A note on running the suite to check a branch

If you are verifying whether **the shipped branch** is healthy, check out the tip of `upstream/runway` itself rather than running your own branch and inferring. *"My branch is red"* and *"the shipped branch is red"* are different claims.

```bash
git worktree add --detach <dir> upstream/runway
ln -s ../../node_modules <dir>/node_modules
cd <dir> && npx vitest run
```

**The symlink must be relative and the worktree must live inside the repo.** A `node_modules` symlink pointing outside the worktree's filesystem root is invisible to vitest and fatal to Turbopack, so a fully green suite can sit on a tree that cannot build.
