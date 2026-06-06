#!/usr/bin/env bash
# SessionStart: surface handoff state, and (only when enabled) sync the current
# branch to its upstream. Repo/branch-agnostic — safe to drop into any repo.
# Auto-pull is OPT-IN: runs only if .claude/handoff-sync-on exists.
set -u
if [ -f .claude/handoff-sync-on ]; then
  UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null)"
  if [ -n "$UPSTREAM" ] && [ -z "$(git status --porcelain 2>/dev/null)" ]; then
    git fetch -q 2>/dev/null \
      && git merge --ff-only "$UPSTREAM" -q 2>/dev/null \
      && echo "✓ synced with $UPSTREAM"
  else
    echo "⚠ no upstream or local changes present — skipping auto-pull"
  fi
else
  echo "ℹ auto-pull disabled (no .claude/handoff-sync-on) — surfacing state only"
fi
echo; echo "===== HANDOFF.md ====="
[ -f HANDOFF.md ] && cat HANDOFF.md || echo "(no HANDOFF.md yet)"
echo; echo "===== last 5 commits ====="
git log --oneline -5 2>/dev/null
