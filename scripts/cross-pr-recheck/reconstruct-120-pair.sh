#!/usr/bin/env bash
# Reconstruction for _R1#120, run from _R1#121.
#
# _R1#108 (fix/108-guard-reachability, merged as fa6bd3f) and _R1#112
# (fix/112-gantt-embed-timing-safe, merged as bbf9958) each landed green
# alone. _R1#120 exists because nothing re-ran the guard suite against
# the two combined before both were on runway, and combined they fail.
#
# This script proves that shape again from stored patches rather than
# from git history. The two patches in this directory were generated
# once, with commands unreachable branch drift cannot break:
#
#   git diff d1c65ff5abe2aac9e00ecdf7436838b5a09a8e7f \
#     8d286197eff942856acf6cc57980730ca4356ebd > 108-alone.patch
#   git diff d1c65ff5abe2aac9e00ecdf7436838b5a09a8e7f \
#     0de6f1c77ee06f58d9dca888ee891ed82ae57292 > 112-alone.patch
#
# d1c65ff5abe2aac9e00ecdf7436838b5a09a8e7f is the merge-base both PR
# heads share, confirmed with `git merge-base` against each head before
# generating these patches. It is itself a squash-merge commit (PR
# #133) directly on runway history, so unlike the two feature branch
# tips, it stays reachable from runway forever and this script only
# ever needs to resolve that one commit, never the two branch tips.
#
# Never run this in the shared main checkout. This script always makes
# its own throwaway clone under $TMPDIR and never touches the caller's
# working tree.
set -euo pipefail

BASE_SHA="d1c65ff5abe2aac9e00ecdf7436838b5a09a8e7f"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Cloning a throwaway copy to $WORK"
git -C "$REPO_ROOT" rev-parse --quiet --verify "$BASE_SHA^{commit}" >/dev/null || {
  echo "FATAL: $BASE_SHA is not reachable from this checkout. Fetch upstream runway first."
  exit 2
}
git clone --quiet "$REPO_ROOT" "$WORK"
cd "$WORK"
git checkout --quiet "$BASE_SHA"

echo "Installing dependencies at the base commit"
env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR \
  pnpm install --frozen-lockfile --silent

run_guard_suite() {
  # Runs with set -e off for exactly this one command, so a red suite
  # does not abort the script before every state has been tried.
  set +e
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR \
    pnpm exec vitest run src/lib/runway/token-compare-guard.test.ts
  local exit_code=$?
  set -e
  return "$exit_code"
}

reset_to_base() {
  git reset --hard --quiet "$BASE_SHA"
  git clean -fdq
}

echo
echo "############################################################"
echo "# STATE 1: #112 alone"
echo "############################################################"
reset_to_base
git apply "$SCRIPT_DIR/112-alone.patch"
STATE1_EXIT=0
run_guard_suite || STATE1_EXIT=$?
echo "=== 112 alone exit code: $STATE1_EXIT ==="

echo
echo "############################################################"
echo "# STATE 2: #108 alone"
echo "############################################################"
reset_to_base
git apply "$SCRIPT_DIR/108-alone.patch"
STATE2_EXIT=0
run_guard_suite || STATE2_EXIT=$?
echo "=== 108 alone exit code: $STATE2_EXIT ==="

echo
echo "############################################################"
echo "# STATE 3: both together"
echo "############################################################"
reset_to_base
git apply "$SCRIPT_DIR/108-alone.patch" "$SCRIPT_DIR/112-alone.patch"
STATE3_EXIT=0
run_guard_suite || STATE3_EXIT=$?
echo "=== both together exit code: $STATE3_EXIT ==="

echo
echo "############################################################"
echo "# SUMMARY"
echo "############################################################"
echo "112 alone exit code: $STATE1_EXIT (0 means green)"
echo "108 alone exit code: $STATE2_EXIT (0 means green)"
echo "both together exit code: $STATE3_EXIT (0 means green)"

if [ "$STATE1_EXIT" -eq 0 ] && [ "$STATE2_EXIT" -eq 0 ] && [ "$STATE3_EXIT" -ne 0 ]; then
  echo "Reproduced the _R1#120 shape: green, green, red."
  exit 0
else
  echo "Did NOT reproduce the expected green, green, red shape. See exit codes above."
  exit 1
fi
