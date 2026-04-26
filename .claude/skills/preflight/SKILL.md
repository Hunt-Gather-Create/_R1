---
name: preflight
description: Run build, tests, and lint to confirm code is clean before committing. Use before /commit or when you want a confidence check.
allowed-tools: Bash(pnpm *), Bash(vercel *), Bash(git *)
---

# Preflight

Pre-commit confidence check. Run build, tests, and lint in sequence — stop on first failure.
Additional gates grep build output for runtime errors that exit 0 but fail in Vercel.

## Steps (run in order — stop on first hard failure)

### Step 1: Build

```bash
pnpm build 2>&1 | tee /tmp/preflight-build.log; echo "BUILD_EXIT:${PIPESTATUS[0]}"
```

Check exit code from `BUILD_EXIT:`. Non-zero = hard fail, report build errors.

### Step 2: Build output grep (HARD FAIL on any match)

After Step 1 completes (regardless of exit code), grep the captured log for patterns that
indicate Vercel-specific runtime failures. These errors are swallowed in some Next.js versions —
`pnpm build` exits 0 while the deploy silently breaks.

Patterns use regex (not literal strings) so quote-style or whitespace variations across Next.js
versions don't slip past the gate. The `Failed to decrypt session` log is intentionally NOT
checked here — it's a legitimate runtime diagnostic for corrupt cookies / missing env vars and
shouldn't gate the build. The cookies sentinel pattern alone catches the deploy-blocking class.

```bash
BUILD_LOG=/tmp/preflight-build.log

echo "=== Preflight: runtime-error grep ==="

patterns=(
  "digest:[[:space:]]*['\"]?DYNAMIC_SERVER_USAGE"
  "Error occurred prerendering"
  "Error: Page with .*getStaticProps"
)

# Test-output markers — exclude these so test logs accidentally redirected
# into the build log (or test source code containing literal sentinel strings)
# can't self-flag the gate.
TEST_EXCLUSIONS='✓|✗|describe\(|it\(|toContain|toBe|toEqual'

grep_failed=0
for pattern in "${patterns[@]}"; do
  matches=$(grep -E "$pattern" "$BUILD_LOG" 2>/dev/null | grep -vE "$TEST_EXCLUSIONS" || true)
  if [ -n "$matches" ]; then
    count=$(echo "$matches" | wc -l | tr -d ' ')
    echo "  HARD FAIL [$count match(es)]: $pattern"
    grep_failed=1
  else
    echo "  OK [0 matches]: $pattern"
  fi
done

if [ "$grep_failed" -eq 1 ]; then
  echo ""
  echo "=== Preflight FAILED: runtime-error patterns found in build output ==="
  echo "These patterns indicate Vercel deploy failures that exit-0 builds miss."
  exit 1
fi

echo "=== Preflight: runtime-error grep PASSED ==="
```

### Step 3: Tests

```bash
pnpm test:run
```

Hard fail if tests fail.

### Step 4: Lint

```bash
pnpm lint
```

Hard fail if lint fails.

### Step 5: Security audit (SOFT — warn only)

```bash
echo "=== Preflight: pnpm audit (soft gate — warn only) ==="
pnpm audit --prod --audit-level=high || true
echo ""
echo "NOTE: Audit findings above are informational. Wave 4 of PR 93 is addressing"
echo "      existing findings. Promote this to a hard fail after those ship."
```

Non-zero exit does NOT block preflight. Report findings in the summary.

### Step 6: Vercel CLI version (informational — never fails)

```bash
echo "=== Preflight: Vercel CLI version ==="
vercel --version 2>/dev/null || echo "vercel CLI not installed (install with: npm i -g vercel@latest)"
```

Log the version for parity-debugging between local and CI environments. Missing CLI is fine.

### Step 7: Vercel build gate (runway branches only — HARD FAIL if exit != 0)

Only run this step if the current branch tracks a remote matching `*runway*`:

```bash
upstream=$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "")
if echo "$upstream" | grep -q "runway"; then
  echo "=== Preflight: vercel build (runway branch detected) ==="
  vercel build 2>&1 | tee /tmp/preflight-vercel-build.log
  vercel_exit=${PIPESTATUS[0]}
  if [ "$vercel_exit" -ne 0 ]; then
    echo ""
    echo "=== Preflight FAILED: vercel build exited $vercel_exit ==="
    echo "Check /tmp/preflight-vercel-build.log for details."
    exit 1
  fi
  echo "=== Preflight: vercel build PASSED ==="
else
  echo "=== Preflight: vercel build skipped (not a runway-tracked branch) ==="
fi
```

To force-run the Vercel build gate on any branch, pass `--vercel` as an argument to the operator.

## On failure

- Report which step failed (build / grep / test / lint / vercel-build) and the relevant output
- For grep failures, show which patterns matched and the surrounding lines from the build log
- Do NOT auto-fix. Show the issue and ask for direction.

## On success

- Report all steps passed with a one-line summary per step
- Ready for `/commit`
