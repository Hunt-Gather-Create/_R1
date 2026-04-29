---
name: canary
description: Deploy a Vercel cross-fork canary preview from the current feature branch. Pre-flight gates, auto-link the worktree if needed, build, deploy, report URL. Replaces the manual `vercel build && vercel deploy --prebuilt` two-liner.
allowed-tools: Bash(vercel *), Bash(git *), Bash(cat *), Bash(jq *), Bash(test *), Bash(ls *)
---

# Canary

Deploy a Vercel preview canary from the current feature branch so the caller can verify a runway-targeted PR builds + deploys clean before pushing upstream.

This skill **only** builds and deploys a preview. It does not push the branch, open a PR, run other skills, or deploy to production.

## Why this exists

Cross-fork PRs (e.g., `jasonburks23/_R1` → `Hunt-Gather-Create/_R1:runway`) do NOT auto-fire a Vercel preview deploy. The merge into `runway` IS the deploy test, which is too late. This skill validates locally first.

## Inputs

No flags. `--prod` is intentionally out of scope. Canary deploys whatever's on disk (clean or dirty tree — `vercel build` doesn't care about git state).

## Step 1: Pre-flight gates (abort on first failure)

Run these in order. Each gate is a hard fail with a specific remediation message — do not auto-fix.

### 1a. Branch is not `main` or `runway`

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
case "$branch" in
  main|runway)
    echo "ABORT: refusing to deploy a canary from '$branch'. Canary is for feature branches only."
    echo "Switch to a feature branch first (e.g., 'git checkout feat/...')."
    exit 1
    ;;
esac
echo "OK: on feature branch '$branch'"
```

### 1b. Vercel CLI installed

```bash
if ! vercel --version >/dev/null 2>&1; then
  echo "ABORT: vercel CLI not found."
  echo "Install with: pnpm install -g vercel  (or: npm install -g vercel)"
  exit 1
fi
echo "OK: vercel $(vercel --version 2>&1 | head -1)"
```

### 1c. Authenticated

```bash
if ! vercel whoami >/dev/null 2>&1; then
  echo "ABORT: not authenticated to Vercel."
  echo "Run: vercel login"
  exit 1
fi
echo "OK: authenticated as $(vercel whoami 2>&1 | tail -1)"
```

### 1d. Worktree linked to a Vercel project

`.vercel/project.json` is gitignored, so every fresh worktree starts unlinked. Step 1.5 below auto-links from a sibling worktree if needed; this gate just records the current state for downstream steps.

```bash
if [ -f .vercel/project.json ] && jq -e '.projectId' .vercel/project.json >/dev/null 2>&1; then
  proj=$(jq -r '.projectName // .projectId' .vercel/project.json)
  echo "OK: worktree linked to '$proj'"
  NEEDS_LINK=0
else
  echo "INFO: worktree not linked yet — Step 1.5 will auto-link from a sibling worktree"
  NEEDS_LINK=1
fi
```

### 1e. Working tree state (informational)

`vercel build` builds from disk — clean and dirty trees both deploy the same. Report state, do not abort. The locked pipeline order is canary → atomic-commits, so a dirty tree is the expected state.

```bash
dirty=$(git status --porcelain)
if [ -n "$dirty" ]; then
  echo "INFO: working tree has uncommitted changes (will be included in canary build):"
  echo "$dirty" | sed 's/^/  /'
else
  echo "OK: working tree clean"
fi
```

## Step 1.5: Auto-link the worktree (if not already linked)

`.vercel/project.json` is gitignored, so each worktree must be linked individually. Rather than asking the operator to run `vercel link` interactively in every new worktree, we copy the link from a sibling worktree by reading its `projectName` and re-linking non-interactively.

If `NEEDS_LINK=0` (set in Step 1d), skip this whole section.

```bash
if [ "${NEEDS_LINK:-0}" -eq 1 ]; then
  echo "=== Canary: auto-link worktree ==="

  # Find a sibling worktree with a valid .vercel/project.json.
  # We're in .worktrees/<this>/, so siblings are at ../*/.vercel/project.json.
  sibling_link=""
  for candidate in ../*/.vercel/project.json; do
    [ -f "$candidate" ] || continue
    if jq -e '.projectId' "$candidate" >/dev/null 2>&1; then
      sibling_link="$candidate"
      break
    fi
  done

  if [ -z "$sibling_link" ]; then
    echo "ABORT: no sibling worktree is linked to a Vercel project."
    echo ""
    echo "This is the one-time setup case — run an interactive 'vercel link' in any worktree"
    echo "to provision the canary project on Vercel's side, then re-run /canary."
    echo "See CLAUDE.md → 'Cross-fork Vercel canary procedure' → one-time setup."
    exit 1
  fi

  proj_name=$(jq -r '.projectName' "$sibling_link")
  proj_id=$(jq -r '.projectId' "$sibling_link")
  echo "Found sibling link: $sibling_link (project: $proj_name)"

  # Non-interactive link to the same project. --yes skips confirmation prompts.
  # Do NOT pass --scope=<personal-account>: Vercel CLI v52 rejects personal accounts as a scope.
  if ! vercel link --yes --project "$proj_name" 2>&1; then
    echo "ABORT: 'vercel link --yes --project $proj_name' failed."
    echo "Try running it manually to see the interactive prompts, or fall back to one-time setup."
    exit 1
  fi

  # Sanity: confirm the link wrote a project.json with the expected id.
  if [ ! -f .vercel/project.json ] || ! jq -e --arg id "$proj_id" '.projectId == $id' .vercel/project.json >/dev/null 2>&1; then
    echo "ABORT: vercel link succeeded but .vercel/project.json is missing or has a different projectId."
    echo "Expected projectId: $proj_id"
    exit 1
  fi
  echo "OK: linked to '$proj_name'"

  # Pull env vars + project config so the build has what it needs.
  echo "=== Canary: vercel pull (production env) ==="
  if ! vercel pull --environment=production --yes 2>&1; then
    echo "ABORT: 'vercel pull' failed. Check auth and project access."
    exit 1
  fi
  echo "OK: env pulled"
fi
```

## Step 2: Build

Run the Vercel build from the worktree root. Capture stdout + stderr to a temp log so the caller can grep failures.

```bash
BUILD_LOG=/tmp/canary-build.log
echo "=== Canary: vercel build ==="
vercel build 2>&1 | tee "$BUILD_LOG"
build_exit=${PIPESTATUS[0]}

if [ "$build_exit" -ne 0 ]; then
  echo ""
  echo "=== Canary FAILED at vercel build (exit $build_exit) ==="
  echo "Full log: $BUILD_LOG"
  echo "Forward stderr above to the operator. Do not retry without diagnosing."
  exit "$build_exit"
fi
echo "=== Canary: build OK ==="
```

## Step 3: Deploy

Deploy the prebuilt output. The link from Step 1.5 (or a prior session) binds this worktree to the canary project, so `vercel deploy` inherits the scope automatically — do NOT pass `--scope=`. Vercel CLI v52 rejects personal accounts as a scope flag value.

Capture stdout so we can parse the preview URL.

```bash
DEPLOY_LOG=/tmp/canary-deploy.log
echo "=== Canary: vercel deploy --prebuilt ==="
vercel deploy --prebuilt 2>&1 | tee "$DEPLOY_LOG"
deploy_exit=${PIPESTATUS[0]}

if [ "$deploy_exit" -ne 0 ]; then
  echo ""
  echo "=== Canary FAILED at vercel deploy (exit $deploy_exit) ==="
  echo "Full log: $DEPLOY_LOG"
  echo "Forward stderr above to the operator. Common causes:"
  echo "  - Worktree not linked: check .vercel/project.json (Step 1.5 should have handled this)"
  echo "  - Missing env vars on canary project: re-seed via Vercel dashboard"
  exit "$deploy_exit"
fi
```

## Step 4: Parse preview URL

Vercel prints the preview URL on its own line, typically `https://...vercel.app`. Pull the last such URL from the deploy log (the final URL is the canonical one).

```bash
PREVIEW_URL=$(grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' "$DEPLOY_LOG" | tail -1)

if [ -z "$PREVIEW_URL" ]; then
  echo ""
  echo "=== Canary: deploy succeeded but URL parse failed ==="
  echo "Look for 'Preview:' or 'https://...vercel.app' in the output below:"
  echo ""
  cat "$DEPLOY_LOG"
  exit 1
fi
```

## Step 5: Report

Print the preview URL and the suggested next steps for the caller. Do **not** auto-execute the push or PR commands — those are the caller's call.

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
echo ""
echo "=== Canary deployed ==="
echo ""
echo "Preview URL: $PREVIEW_URL"
echo ""
echo "Verification steps:"
echo "  1. Open ${PREVIEW_URL}/runway and verify the changes against the PR scope."
echo "  2. The canary uses prod credentials + prod Turso DB — do NOT interact like a normal user."
echo "     (Clicks write to prod. The canary's purpose is build + deploy verification, not functional testing.)"
echo "  3. WorkOS auth will fail on the canary domain because NEXT_PUBLIC_WORKOS_REDIRECT_URI"
echo "     doesn't include it — that's expected, not a deploy failure."
echo "  4. Report status (green / red) back to the operator."
echo ""
echo "If green, the suggested push + PR commands are:"
echo ""
echo "  git push origin ${branch}"
echo "  gh pr create --base runway --head Hunt-Gather-Create:${branch} \\"
echo "    --title \"<title>\" --body \"<body>\""
echo ""
echo "(Do NOT run those automatically. Operator drives the push.)"
```

## What this skill explicitly does NOT do

- Does not push the branch
- Does not open a PR
- Does not run `/preflight`, `/code-review`, `/pr-ready`, `/update-docs`, or `/atomic-commits` — those are separate skills called in their own pipeline steps
- Does not auto-verify the preview (the caller or operator clicks through)
- Does not deploy to production (`--prod` is out of scope; this is preview canaries only)

## Failure modes (cheat sheet)

| Symptom | Remediation |
|---|---|
| `vercel: command not found` | `pnpm install -g vercel` (or `npm install -g vercel`) |
| `vercel whoami` exits non-zero | `vercel login` |
| No sibling worktree is linked (Step 1.5 abort) | Run interactive `vercel link` once in any worktree to provision the canary project. See CLAUDE.md → "Cross-fork Vercel canary procedure" → one-time setup. |
| `vercel link --yes --project ...` fails | Verify `vercel whoami` matches the account that owns the canary project; run `vercel link` interactively to see the prompts. |
| `vercel: --scope=<your-personal-account> is not valid` | Don't pass `--scope=` for personal accounts (CLI v52 rejects them). The link binds the project; commands inherit it. |
| On `main` or `runway` | Switch to a feature branch first |
| Build fails | Forward `vercel build` stderr verbatim; do not retry blindly |
| Deploy fails | Forward `vercel deploy` stderr verbatim; check `.vercel/project.json` + env vars |
| URL parse fails but deploy succeeded | Print full deploy stdout; the URL is in there somewhere on a `https://...vercel.app` line |
