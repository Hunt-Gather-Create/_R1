#!/bin/bash
set -euo pipefail

usage() {
  echo "Usage: scripts/worktree.sh <name> [--no-claude]"
  echo ""
  echo "Creates a git worktree at .worktrees/<name> with branch feature/<name>,"
  echo "copies .env.local, installs dependencies, runs migrations, and launches claude."
  echo ""
  echo "If the worktree already exists, cd into it and launch claude."
  echo ""
  echo "Options:"
  echo "  --no-claude   Skip launching claude (prints cd command instead)"
  exit 1
}

name=""
launch_claude=true

for arg in "$@"; do
  case "$arg" in
    --no-claude) launch_claude=false ;;
    --help|-h) usage ;;
    -*) echo "Unknown option: $arg"; usage ;;
    *) name="$arg" ;;
  esac
done

if [ -z "$name" ]; then
  usage
fi

repo_root="$(git rev-parse --show-toplevel)"
worktree_dir="$repo_root/.worktrees/$name"
branch="feature/$name"

if [ -d "$worktree_dir" ]; then
  echo "Worktree already exists at .worktrees/$name"
else
  echo "Creating worktree .worktrees/$name on branch $branch..."
  git worktree add -B "$branch" "$worktree_dir"
  cp "$repo_root/.env.local" "$worktree_dir/"

  cd "$worktree_dir"
  echo "Installing dependencies..."
  pnpm install
  echo "Running migrations..."
  pnpm db:migrate
fi

if [ "$launch_claude" = true ]; then
  cd "$worktree_dir"
  exec claude --chrome --dangerously-skip-permissions
else
  echo ""
  echo "Ready! Run:"
  echo "  cd $worktree_dir"
fi
