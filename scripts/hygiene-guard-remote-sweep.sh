#!/bin/sh
# hygiene-guard-remote-sweep.sh -- scheduled caller for hygiene-guard.sh's
# remote-sweep mode (opeff#1040).
#
# The local pre-push hook (scripts/hooks/pre-push) already runs the guard's
# local-branch/worktree arm on every push, plus the project's own test
# suite. This script is a SEPARATE, scheduled entry point: it fetches
# $remote with --prune, then runs the guard's remote-branch arm to report
# (never delete) disposable remote branches. It deliberately does NOT run
# the test suite -- opeff#1040's own acceptance bar is that the scheduled
# caller stays lightweight and mechanical, unlike the push-time hook, which
# has a live push to gate and a suite to protect it with. Wire this into
# cron/launchd on whatever cadence the fleet picks; it is not installed as
# a git hook itself, since nothing about a periodic sweep is tied to a push
# event.
#
# Usage: sh hygiene-guard-remote-sweep.sh [repo-path] [remote-name] [guard-path] [hold-path] [trunk-branch]
# All five arguments pass straight through to hygiene-guard.sh; see that
# file's own usage comment for what each one means and its default.
set -eu

root="${1:-$(pwd)}"
remote="${2:-origin}"
guard_path="${3:-scripts/hygiene-guard.sh}"
hold_path="${4:-}"
trunk_override="${5:-}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

git -C "$root" fetch "$remote" --prune
sh "$script_dir/hygiene-guard.sh" "$root" "$remote" "$guard_path" "$hold_path" "$trunk_override" remote-sweep
