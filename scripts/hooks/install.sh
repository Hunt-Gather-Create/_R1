#!/bin/sh
# Install the repo's git hooks (_R1#107, part 1).
#
# Points core.hooksPath at scripts/hooks so the hooks are version-controlled
# and reviewable, instead of living unversioned in .git/hooks.
#
# Run once per clone AND once per git worktree — core.hooksPath is per
# working tree, so a fresh worktree starts without hooks. That is one of the
# several reasons a local hook is not a gate.
set -e
root=$(git rev-parse --show-toplevel)
git config core.hooksPath scripts/hooks
echo "hooks installed: core.hooksPath -> scripts/hooks (in $root)"
echo "reminder: this is a convenience, not a gate. The gate is the PR check."
