#!/bin/bash
set -euo pipefail

# Clean up worktrees whose branches have been merged into main.
# Usage:
#   scripts/worktree-clean.sh          # dry-run (show what would be removed)
#   scripts/worktree-clean.sh --force  # actually remove them

force=false
for arg in "$@"; do
  case "$arg" in
    --force|-f) force=true ;;
    --help|-h)
      echo "Usage: scripts/worktree-clean.sh [--force]"
      echo ""
      echo "Finds worktrees whose branches have been merged into main and removes them."
      echo "Without --force, runs in dry-run mode (shows what would be removed)."
      exit 0
      ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"

echo "Checking worktrees for merged branches..."
echo ""

removed_count=0
merged_count=0

git worktree list --porcelain | grep "^branch " | sed 's|branch refs/heads/||' | while read -r branch; do
  # Skip main itself
  [ "$branch" = "main" ] && continue

  if git branch --merged main | grep -qw "$branch"; then
    merged_count=$((merged_count + 1))

    # Find the worktree path for this branch
    worktree_path=$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '
      /^worktree / { path = substr($0, 10) }
      /^branch /   { if (substr($0, 8) == b) print path }
    ')

    if [ -z "$worktree_path" ]; then
      echo "  WARNING: could not find worktree path for branch $branch"
      continue
    fi

    if [ "$force" = true ]; then
      echo "  Removing: $branch ($worktree_path)"
      git worktree remove "$worktree_path"
      git branch -d "$branch"
      removed_count=$((removed_count + 1))
    else
      echo "  merged:   $branch ($worktree_path)"
    fi
  fi
done

echo ""
if [ "$force" = true ]; then
  echo "Done. Removed merged worktree(s)."
else
  echo "Dry run complete. Use --force to remove merged worktrees."
fi

# Prune any stale worktree references
git worktree prune
